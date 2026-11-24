package services

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/twmb/franz-go/pkg/kadm"
	"kaflow/backend/connection"
	"kaflow/backend/models"
)

// TopicService exposes topic management (list/describe/configs/create/alter/delete) to the frontend.
type TopicService struct {
	mgr *connection.ConnectionManager
}

// NewTopicService creates a new TopicService.
func NewTopicService(mgr *connection.ConnectionManager) *TopicService {
	return &TopicService{mgr: mgr}
}

// topicInfoFromDetail converts a kadm topic detail (with partition info) to a model.
func topicInfoFromDetail(td kadm.TopicDetail) models.TopicInfo {
	info := models.TopicInfo{
		Name:     td.Topic,
		Internal: td.IsInternal,
	}
	if td.Err != nil {
		return info
	}

	info.Partitions = len(td.Partitions)
	if info.Partitions > 0 {
		// replication factor is taken from the first partition (all partitions match by default)
		p0 := td.Partitions[0]
		info.ReplicationFactor = len(p0.Replicas)
	}

	for _, p := range td.Partitions.Sorted() {
		if p.Err != nil {
			continue
		}
		info.PartitionDetails = append(info.PartitionDetails, models.PartitionInfo{
			Id:              p.Partition,
			Leader:          p.Leader,
			Replicas:        p.Replicas,
			Isr:             p.ISR,
			OfflineReplicas: p.OfflineReplicas,
		})
	}
	return info
}

// ListTopics returns all non-internal topics in the cluster.
func (s *TopicService) ListTopics(connId string) ([]models.TopicInfo, error) {
	mc, err := s.mgr.GetClient(connId)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	meta, err := mc.Admin.Metadata(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to load topic metadata: %w", err)
	}

	topics := make([]models.TopicInfo, 0, len(meta.Topics))
	for _, td := range meta.Topics.Sorted() {
		if td.IsInternal || td.Err != nil {
			continue
		}
		topics = append(topics, topicInfoFromDetail(td))
	}
	return topics, nil
}

// GetTopicDetails describes one topic: partition layout plus effective configs.
func (s *TopicService) GetTopicDetails(connId string, topic string) (*models.TopicInfo, error) {
	mc, err := s.mgr.GetClient(connId)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	meta, err := mc.Admin.Metadata(ctx, topic)
	if err != nil {
		return nil, fmt.Errorf("failed to load topic metadata: %w", err)
	}
	td, ok := meta.Topics[topic]
	if !ok {
		return nil, fmt.Errorf("topic %s not found", topic)
	}

	info := topicInfoFromDetail(td)

	// Attach high/low watermarks per partition
	if ends, err := mc.Admin.ListEndOffsets(ctx, topic); err == nil {
		starts, startErr := mc.Admin.ListStartOffsets(ctx, topic)
		for i := range info.PartitionDetails {
			p := &info.PartitionDetails[i]
			if lo, ok := ends.Lookup(topic, p.Id); ok && lo.Err == nil {
				p.LogEndOffset = lo.Offset
			}
			if startErr == nil {
				if lo, ok := starts.Lookup(topic, p.Id); ok && lo.Err == nil {
					p.LogStartOffset = lo.Offset
				}
			}
		}
	}

	// Attach configs (non-sensitive values only)
	res, err := mc.Admin.DescribeTopicConfigs(ctx, topic)
	if err == nil && len(res) > 0 && res[0].Err == nil {
		info.Configs = make(map[string]string, len(res[0].Configs))
		for _, cfg := range res[0].Configs {
			if cfg.Sensitive {
				continue
			}
			info.Configs[cfg.Key] = cfg.MaybeValue()
		}
	}

	return &info, nil
}

// CreateTopic creates a new topic with the given partition count, replication
// factor and optional configs.
func (s *TopicService) CreateTopic(connId string, name string, partitions int32, replicationFactor int16, configs map[string]string) error {
	mc, err := s.mgr.GetClient(connId)
	if err != nil {
		return err
	}
	if mc.Config.ReadOnly {
		return fmt.Errorf("connection is in read-only mode")
	}
	if name == "" {
		return fmt.Errorf("topic name is required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	cfgPtrs := make(map[string]*string, len(configs))
	for k, v := range configs {
		val := v
		cfgPtrs[k] = &val
	}

	if replicationFactor <= 0 {
		replicationFactor = resolveDefaultRF(ctx, mc.Admin)
	}

	resp, err := mc.Admin.CreateTopic(ctx, partitions, replicationFactor, cfgPtrs, name)
	if resp.Err != nil {
		return formatAdminErr(resp.Err, resp.ErrMessage)
	}
	return err
}

// resolveDefaultRF turns a non-positive RF into an explicit value because some
// broker CreateTopicPolicy implementations reject -1.
func resolveDefaultRF(ctx context.Context, admin *kadm.Client) int16 {
	meta, err := admin.BrokerMetadata(ctx)
	if err != nil || len(meta.Brokers) == 0 {
		return -1
	}
	var cfgRF int16
	brokerID := meta.Brokers[0].NodeID
	if res, err := admin.DescribeBrokerConfigs(ctx, brokerID); err == nil {
		if rc, rerr := res.On(strconv.Itoa(int(brokerID)), nil); rerr == nil && rc.Err == nil {
			for _, c := range rc.Configs {
				if c.Key == "default.replication.factor" {
					if v, perr := strconv.ParseInt(c.MaybeValue(), 10, 16); perr == nil && v > 0 {
						cfgRF = int16(v)
					}
					break
				}
			}
		}
	}
	return pickDefaultRF(cfgRF, len(meta.Brokers))
}

func pickDefaultRF(cfgRF int16, brokerCount int) int16 {
	if cfgRF > 0 {
		return cfgRF
	}
	if brokerCount <= 0 {
		return -1
	}
	if brokerCount > 3 {
		return 3
	}
	return int16(brokerCount)
}

func formatAdminErr(err error, msg string) error {
	if err != nil && msg != "" {
		return fmt.Errorf("%w: %s", err, msg)
	}
	return err
}

// DeleteTopic deletes a topic by name.
func (s *TopicService) DeleteTopic(connId string, topic string) error {
	mc, err := s.mgr.GetClient(connId)
	if err != nil {
		return err
	}
	if mc.Config.ReadOnly {
		return fmt.Errorf("connection is in read-only mode")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	resp, err := mc.Admin.DeleteTopic(ctx, topic)
	if resp.Err != nil {
		return formatAdminErr(resp.Err, resp.ErrMessage)
	}
	return err
}

// IncreasePartitions adds partitions to an existing topic.
func (s *TopicService) IncreasePartitions(connId string, topic string, add int32) error {
	mc, err := s.mgr.GetClient(connId)
	if err != nil {
		return err
	}
	if mc.Config.ReadOnly {
		return fmt.Errorf("connection is in read-only mode")
	}
	if add <= 0 {
		return fmt.Errorf("partition count to add must be positive")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	resp, err := mc.Admin.CreatePartitions(ctx, int(add), topic)
	if err != nil {
		return err
	}
	return formatAdminErr(resp[topic].Err, resp[topic].ErrMessage)
}

// UpdateTopicConfig sets a single dynamic topic configuration.
func (s *TopicService) UpdateTopicConfig(connId string, topic string, key string, value string) error {
	mc, err := s.mgr.GetClient(connId)
	if err != nil {
		return err
	}
	if mc.Config.ReadOnly {
		return fmt.Errorf("connection is in read-only mode")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	resp, err := mc.Admin.AlterTopicConfigs(ctx, []kadm.AlterConfig{
		{Op: kadm.SetConfig, Name: key, Value: kadm.StringPtr(value)},
	}, topic)
	if err != nil {
		return err
	}
	if _, rerr := resp.On(topic, func(rc *kadm.AlterConfigsResponse) error { return rc.Err }); rerr != nil {
		return rerr
	}
	return nil
}
