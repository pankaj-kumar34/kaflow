package services

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kgo"
	"kaflow/backend/connection"
	"kaflow/backend/models"
)

const (
	maxRecordValueBytes   = 512 * 1024
	maxRecordKeyBytes     = 16 * 1024
	maxBinaryHexBytes     = 4096
	maxFullBinaryHexBytes = 512 * 1024 // shortcut: caps full-record hex/base64 view to avoid DOM OOM, upgrade to file download if larger binary inspection is needed
)

// MessageService exposes fetching and producing records on topics to the frontend.
type MessageService struct {
	mgr         *connection.ConnectionManager
	fetchMu     sync.Mutex
	schemaMu    sync.RWMutex
	schemaCache map[string]models.SchemaInfo
}

// NewMessageService creates a new MessageService.
func NewMessageService(mgr *connection.ConnectionManager) *MessageService {
	return &MessageService{
		mgr:         mgr,
		schemaCache: make(map[string]models.SchemaInfo),
	}
}

func truncateUTF8(b []byte, maxBytes int) (string, bool) {
	if maxBytes <= 0 || len(b) <= maxBytes {
		return string(b), false
	}
	cut := maxBytes
	for cut > 0 && !utf8.RuneStart(b[cut]) {
		cut--
	}
	return string(b[:cut]), true
}

func formatBinaryPayload(b []byte, maxBytes int) (string, bool) {
	truncated := maxBytes > 0 && len(b) > maxBytes
	sample := b
	if truncated {
		sample = b[:maxBytes]
	}
	b64 := base64.StdEncoding.EncodeToString(sample)
	hexDump := hex.Dump(sample)
	var out strings.Builder
	fmt.Fprintf(&out, "Binary payload (%d bytes)\n\nBase64:\n%s\n\nHex:\n%s", len(b), b64, hexDump)
	if truncated {
		fmt.Fprintf(&out, "\n… [truncated to first %d bytes]", maxBytes)
	}
	return out.String(), truncated
}

// recordToModel converts a franz-go record to the frontend model, capping large payloads
// and detecting Confluent wire-format schema headers / binary payloads.
func recordToModel(rec *kgo.Record) models.MessageRecord {
	return recordToModelWithLimits(rec, maxRecordValueBytes, maxBinaryHexBytes)
}

func recordToModelWithLimits(rec *kgo.Record, maxValBytes, maxBinBytes int) models.MessageRecord {
	headers := make([]models.MessageHeader, 0, len(rec.Headers))
	for _, h := range rec.Headers {
		headers = append(headers, models.MessageHeader{Key: h.Key, Value: string(h.Value)})
	}

	keyLimit := maxRecordKeyBytes
	if maxValBytes <= 0 {
		keyLimit = 0
	}
	keyStr, _ := truncateUTF8(rec.Key, keyLimit)
	raw := rec.Value
	totalSize := len(raw)

	var schemaId uint32
	payload := raw
	// Confluent wire format: 0x00 magic byte + 4-byte big-endian schema ID.
	if len(raw) >= 5 && raw[0] == 0x00 {
		if id := binary.BigEndian.Uint32(raw[1:5]); id > 0 {
			schemaId = id
			payload = raw[5:]
		}
	}

	var valStr string
	var truncated, isBinary bool
	if len(payload) > 0 && !utf8.Valid(payload) {
		isBinary = true
		valStr, truncated = formatBinaryPayload(payload, maxBinBytes)
	} else {
		valStr, truncated = truncateUTF8(payload, maxValBytes)
	}

	return models.MessageRecord{
		Topic:     rec.Topic,
		Partition: rec.Partition,
		Offset:    rec.Offset,
		Timestamp: rec.Timestamp.UnixMilli(),
		Key:       keyStr,
		Value:     valStr,
		Headers:   headers,
		Size:      totalSize,
		Truncated: truncated,
		SchemaId:  schemaId,
		Binary:    isBinary,
	}
}

// GetSchemaById fetches a schema from the connection's configured Schema Registry.
func (s *MessageService) GetSchemaById(connId string, schemaId uint32) (*models.SchemaInfo, error) {
	if schemaId == 0 {
		return nil, fmt.Errorf("invalid schema id")
	}
	mc, err := s.mgr.GetClient(connId)
	if err != nil {
		return nil, err
	}
	baseURL := strings.TrimRight(strings.TrimSpace(mc.Config.SchemaRegistryUrl), "/")
	if baseURL == "" {
		return nil, fmt.Errorf("schema registry URL is not configured")
	}

	cacheKey := fmt.Sprintf("%s#%d", baseURL, schemaId)
	s.schemaMu.RLock()
	if cached, ok := s.schemaCache[cacheKey]; ok {
		s.schemaMu.RUnlock()
		return &cached, nil
	}
	s.schemaMu.RUnlock()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("%s/schemas/ids/%d", baseURL, schemaId), nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("schema registry request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("schema registry returned HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if err != nil {
		return nil, err
	}

	var parsed struct {
		SchemaType string `json:"schemaType"`
		Schema     string `json:"schema"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("invalid schema registry response: %w", err)
	}
	if parsed.SchemaType == "" {
		parsed.SchemaType = "AVRO"
	}
	info := models.SchemaInfo{
		Id:         schemaId,
		SchemaType: parsed.SchemaType,
		Schema:     parsed.Schema,
	}

	s.schemaMu.Lock()
	if s.schemaCache == nil {
		s.schemaCache = make(map[string]models.SchemaInfo)
	}
	s.schemaCache[cacheKey] = info
	s.schemaMu.Unlock()

	return &info, nil
}

// GetWatermarks returns the log start offset and high watermark for a partition
// (partition -1 returns the oldest start / newest end across all partitions).
func (s *MessageService) GetWatermarks(connId string, topic string, partition int32) (int64, int64, error) {
	mc, err := s.mgr.GetClient(connId)
	if err != nil {
		return 0, 0, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	starts, err := mc.Admin.ListStartOffsets(ctx, topic)
	if err != nil {
		return 0, 0, fmt.Errorf("failed to list start offsets: %w", err)
	}
	ends, err := mc.Admin.ListEndOffsets(ctx, topic)
	if err != nil {
		return 0, 0, fmt.Errorf("failed to list end offsets: %w", err)
	}

	oldest, newest := int64(-1), int64(-1)
	for p, lo := range starts[topic] {
		if partition >= 0 && p != partition {
			continue
		}
		if lo.Err != nil {
			continue
		}
		if oldest == -1 || lo.Offset < oldest {
			oldest = lo.Offset
		}
	}
	for p, lo := range ends[topic] {
		if partition >= 0 && p != partition {
			continue
		}
		if lo.Err != nil {
			continue
		}
		if lo.Offset > newest {
			newest = lo.Offset
		}
	}
	return oldest, newest, nil
}

// FetchMessages reads up to limit records from a topic beginning at fromOffset
// (use -1 to read the newest limit records from the end of the log).
func (s *MessageService) FetchMessages(connId string, topic string, partition int32, fromOffset int64, limit int) (*models.FetchResult, error) {
	mc, err := s.mgr.GetClient(connId)
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 10000 {
		limit = 500
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	// Resolve start offset(s): -1 means "last limit records" per partition relative to its watermark
	var assignment map[string]map[int32]kgo.Offset
	if fromOffset < 0 {
		if partition >= 0 {
			start, end, err := s.GetWatermarks(connId, topic, partition)
			if err != nil {
				return nil, err
			}
			if end <= start {
				return &models.FetchResult{
					Topic:       topic,
					Partition:   partition,
					Messages:    []models.MessageRecord{},
					StartOffset: start,
					EndOffset:   end,
				}, nil
			}
			fromOffset = max(start, end-int64(limit))
			assignment, err = s.assignmentFor(ctx, mc, topic, partition, fromOffset)
			if err != nil {
				return nil, err
			}
		} else {
			assignment, fromOffset, err = s.tailAssignmentAllPartitions(ctx, mc, topic, int64(limit))
			if err != nil {
				return nil, err
			}
		}
	} else {
		assignment, err = s.assignmentFor(ctx, mc, topic, partition, fromOffset)
		if err != nil {
			return nil, err
		}
	}

	if len(assignment) == 0 {
		return &models.FetchResult{
			Topic:       topic,
			Partition:   partition,
			Messages:    []models.MessageRecord{},
			StartOffset: fromOffset,
		}, nil
	}

	s.fetchMu.Lock()
	mc.Client.AddConsumePartitions(assignment)
	defer func() {
		mc.Client.RemoveConsumePartitions(partitionsOf(assignment))
		s.fetchMu.Unlock()
	}()

	fetchCtx, fetchCancel := context.WithTimeout(ctx, 15*time.Second)
	defer fetchCancel()

	result := &models.FetchResult{
		Topic:       topic,
		Partition:   partition,
		Messages:    make([]models.MessageRecord, 0, limit),
		StartOffset: fromOffset,
	}

	for len(result.Messages) < limit {
		pollCtx := fetchCtx
		var pollCancel context.CancelFunc
		if len(result.Messages) > 0 {
			// Once records start arriving, use a short idle window so topics with
			// fewer than `limit` messages return promptly instead of waiting 15s.
			pollCtx, pollCancel = context.WithTimeout(fetchCtx, 400*time.Millisecond)
		}
		fetches := mc.Client.PollRecords(pollCtx, limit-len(result.Messages))
		if pollCancel != nil {
			pollCancel()
		}
		if fetches.Empty() {
			break
		}
		var fetchErr error
		fetches.EachError(func(t string, p int32, err error) {
			fetchErr = err
		})
		fetches.EachRecord(func(rec *kgo.Record) {
			result.Messages = append(result.Messages, recordToModel(rec))
		})
		if fetchErr != nil {
			if len(result.Messages) == 0 {
				if errors.Is(fetchErr, context.DeadlineExceeded) {
					return nil, fmt.Errorf("timed out waiting for records from %s (broker unreachable or offsets contain only compacted/control records)", topic)
				}
				return nil, fetchErr
			}
			break
		}
	}

	if partition >= 0 {
		start, end, err := s.GetWatermarks(connId, topic, partition)
		if err == nil {
			result.StartOffset, result.EndOffset = start, end
		}
	}

	sort.SliceStable(result.Messages, func(i, j int) bool {
		a, b := &result.Messages[i], &result.Messages[j]
		if a.Partition != b.Partition {
			return a.Partition < b.Partition
		}
		return a.Offset < b.Offset
	})

	return result, nil
}

// GetMessage fetches a single record at (topic, partition, offset) without list preview truncation.
func (s *MessageService) GetMessage(connId string, topic string, partition int32, offset int64) (*models.MessageRecord, error) {
	if topic == "" || partition < 0 || offset < 0 {
		return nil, fmt.Errorf("valid topic, partition, and offset are required")
	}
	mc, err := s.mgr.GetClient(connId)
	if err != nil {
		return nil, err
	}

	assignment := map[string]map[int32]kgo.Offset{
		topic: {partition: kgo.NewOffset().At(offset)},
	}

	s.fetchMu.Lock()
	mc.Client.AddConsumePartitions(assignment)
	defer func() {
		mc.Client.RemoveConsumePartitions(partitionsOf(assignment))
		s.fetchMu.Unlock()
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	for {
		fetches := mc.Client.PollRecords(ctx, 1)
		if fetches.Empty() {
			break
		}
		var fetchErr error
		fetches.EachError(func(_ string, _ int32, err error) {
			fetchErr = err
		})
		var found *models.MessageRecord
		var passed bool
		fetches.EachRecord(func(rec *kgo.Record) {
			if rec.Offset == offset {
				m := recordToModelWithLimits(rec, 0, maxFullBinaryHexBytes)
				found = &m
			} else if rec.Offset > offset {
				passed = true
			}
		})
		if found != nil {
			return found, nil
		}
		if passed {
			return nil, fmt.Errorf("record at partition %d offset %d no longer exists (compacted or expired)", partition, offset)
		}
		if fetchErr != nil {
			return nil, fetchErr
		}
	}
	return nil, fmt.Errorf("record at partition %d offset %d not found", partition, offset)
}

// tailAssignmentAllPartitions computes per-partition start offsets so low-offset partitions are not skipped.
func (s *MessageService) tailAssignmentAllPartitions(ctx context.Context, mc *connection.ManagedClient, topic string, limit int64) (map[string]map[int32]kgo.Offset, int64, error) {
	starts, err := mc.Admin.ListStartOffsets(ctx, topic)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to list start offsets: %w", err)
	}
	ends, err := mc.Admin.ListEndOffsets(ctx, topic)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to list end offsets: %w", err)
	}

	offsets, minFrom := buildTailOffsets(topic, starts, ends, limit)
	return kadmOffsets(offsets), minFrom, nil
}

func buildTailOffsets(topic string, starts, ends kadm.ListedOffsets, limit int64) (kadm.Offsets, int64) {
	offsets := kadm.Offsets{}
	minFrom := int64(-1)
	for p, endLo := range ends[topic] {
		if endLo.Err != nil {
			continue
		}
		var pStart int64
		if startLo, ok := starts.Lookup(topic, p); ok && startLo.Err == nil {
			pStart = startLo.Offset
		}
		if endLo.Offset <= pStart {
			continue
		}
		from := max(pStart, endLo.Offset-limit)
		offsets.AddOffset(topic, p, from, -1)
		if minFrom == -1 || from < minFrom {
			minFrom = from
		}
	}
	if minFrom < 0 {
		minFrom = 0
	}
	return offsets, minFrom
}

// assignmentFor builds the partition->offset assignment for a fetch/tail.
func (s *MessageService) assignmentFor(ctx context.Context, mc *connection.ManagedClient, topic string, partition int32, atOffset int64) (map[string]map[int32]kgo.Offset, error) {
	// Discover partitions to assign; a specific partition short-circuits this.
	partitions := []int32{partition}
	if partition < 0 {
		meta, err := mc.Admin.Metadata(ctx, topic)
		if err != nil {
			return nil, fmt.Errorf("failed to load topic metadata: %w", err)
		}
		td, ok := meta.Topics[topic]
		if !ok || td.Err != nil {
			return nil, fmt.Errorf("topic %s not found", topic)
		}
		partitions = make([]int32, 0, len(td.Partitions))
		for _, p := range td.Partitions {
			partitions = append(partitions, p.Partition)
		}
	}

	offsets := kadm.Offsets{}
	for _, p := range partitions {
		offsets.AddOffset(topic, p, atOffset, -1)
	}
	return kadmOffsets(offsets), nil
}

// kadmOffsets converts kadm offsets to the Offset map AddConsumePartitions consumes.
func kadmOffsets(o kadm.Offsets) map[string]map[int32]kgo.Offset {
	out := make(map[string]map[int32]kgo.Offset)
	o.Each(func(off kadm.Offset) {
		m := out[off.Topic]
		if m == nil {
			m = make(map[int32]kgo.Offset)
			out[off.Topic] = m
		}
		m[off.Partition] = kgo.NewOffset().At(off.At)
	})
	return out
}

// partitionsOf lists the partitions in an assignment, for RemoveConsumePartitions.
func partitionsOf(a map[string]map[int32]kgo.Offset) map[string][]int32 {
	out := make(map[string][]int32, len(a))
	for t, ps := range a {
		l := make([]int32, 0, len(ps))
		for p := range ps {
			l = append(l, p)
		}
		out[t] = l
	}
	return out
}

// ProduceMessage writes a single record to a topic (partition -1 lets Kafka choose).
func (s *MessageService) ProduceMessage(connId string, topic string, partition int32, key string, value string, headers []models.MessageHeader) error {
	mc, err := s.mgr.GetClient(connId)
	if err != nil {
		return err
	}
	if mc.Config.ReadOnly {
		return fmt.Errorf("connection is in read-only mode")
	}

	rec := &kgo.Record{
		Topic:     topic,
		Partition: partition,
		Key:       []byte(key),
		Value:     []byte(value),
	}
	if partition < 0 {
		rec.Partition = -1
	}
	for _, h := range headers {
		rec.Headers = append(rec.Headers, kgo.RecordHeader{Key: h.Key, Value: []byte(h.Value)})
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	return mc.Client.ProduceSync(ctx, rec).FirstErr()
}
