package services

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/wailsapp/wails/v3/pkg/application"
	"kaflow/backend/connection"
	"kaflow/backend/models"
)

// tailSession tracks a live tail consumer for one connection.
type tailSession struct {
	client *kgo.Client
	cancel context.CancelFunc
}

// TailService tails live records from topics and relays them to the frontend
// as "kaflow:message" events.
type TailService struct {
	mgr   *connection.ConnectionManager
	mu    sync.Mutex
	tails map[string]*tailSession
}

// NewTailService creates a new TailService.
func NewTailService(mgr *connection.ConnectionManager) *TailService {
	return &TailService{
		mgr:   mgr,
		tails: make(map[string]*tailSession),
	}
}

// StartTail begins tailing a topic (partition -1 tails all partitions),
// starting at the latest offsets (fromLatest) or the oldest ones.
func (s *TailService) StartTail(connId string, topic string, partition int32, fromLatest bool) error {
	mc, err := s.mgr.GetClient(connId)
	if err != nil {
		return err
	}

	// Stop any existing tail for this connection before dialing a new one
	s.mu.Lock()
	if session, exists := s.tails[connId]; exists {
		session.cancel()
		session.client.Close()
		delete(s.tails, connId)
	}
	s.mu.Unlock()

	client, tunnel, err := connection.NewKgoClient(context.Background(), mc.Config, s.mgr.Dialer)
	if err != nil {
		return err
	}
	admin := kadm.NewClient(client)

	ctx, cancel := context.WithCancel(context.Background())

	// Determine partitions to tail
	partitions := []int32{partition}
	if partition < 0 {
		meta, err := admin.Metadata(ctx, topic)
		if err != nil {
			client.Close()
			if tunnel != nil {
				_ = tunnel.Close()
			}
			cancel()
			return fmt.Errorf("failed to load topic metadata: %w", err)
		}
		td, ok := meta.Topics[topic]
		if !ok || td.Err != nil {
			client.Close()
			if tunnel != nil {
				_ = tunnel.Close()
			}
			cancel()
			return fmt.Errorf("topic %s not found", topic)
		}
		partitions = partitions[:0]
		for _, p := range td.Partitions {
			partitions = append(partitions, p.Partition)
		}
	}

	// Resolve start offsets (latest = high watermark, oldest = log start)
	var listed kadm.ListedOffsets
	if fromLatest {
		listed, err = admin.ListEndOffsets(ctx, topic)
	} else {
		listed, err = admin.ListStartOffsets(ctx, topic)
	}
	if err != nil {
		client.Close()
		if tunnel != nil {
			_ = tunnel.Close()
		}
		cancel()
		return fmt.Errorf("failed to resolve start offsets: %w", err)
	}

	offsets := kadm.Offsets{}
	for _, p := range partitions {
		if lo, ok := listed.Lookup(topic, p); ok && lo.Err == nil {
			offsets.AddOffset(topic, p, lo.Offset, lo.LeaderEpoch)
		}
	}
	// AddConsumePartitions assigns the partitions; SetOffsets alone is a no-op
	// for partitions that are not yet assigned.
	client.AddConsumePartitions(kadmOffsets(offsets))

	s.mu.Lock()
	if _, activeErr := s.mgr.GetClient(connId); activeErr != nil {
		s.mu.Unlock()
		client.Close()
		if tunnel != nil {
			_ = tunnel.Close()
		}
		cancel()
		return activeErr
	}
	if prev, exists := s.tails[connId]; exists {
		prev.cancel()
		prev.client.Close()
	}
	s.tails[connId] = &tailSession{client: client, cancel: cancel}
	s.mu.Unlock()

	go func() {
		defer func() {
			if tunnel != nil {
				_ = tunnel.Close()
			}
		}()
		for {
			select {
			case <-ctx.Done():
				return
			default:
			}
			fetches := client.PollRecords(ctx, 100)
			clientClosed := false
			fetches.EachError(func(t string, p int32, err error) {
				if errors.Is(err, kgo.ErrClientClosed) {
					clientClosed = true
				}
			})
			if clientClosed {
				return
			}
			fetches.EachRecord(func(rec *kgo.Record) {
				if app := application.Get(); app != nil {
					app.Event.Emit("kaflow:message", models.MessageEvent{
						MessageRecord: recordToModel(rec),
						ConnId:        connId,
					})
				}
			})
		}
	}()

	return nil
}

// StopTail stops tailing on the specified connection.
func (s *TailService) StopTail(connId string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if session, exists := s.tails[connId]; exists {
		session.cancel()
		session.client.Close()
		delete(s.tails, connId)
	}
	return nil
}

// IsTailing reports whether a live tail is active on the connection.
func (s *TailService) IsTailing(connId string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, exists := s.tails[connId]
	return exists
}
