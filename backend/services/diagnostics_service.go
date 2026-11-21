package services

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kmsg"
	"kaflow/backend/connection"
	"kaflow/backend/models"
)

// DiagnosticsService exposes cluster/broker diagnostics to the frontend.
type DiagnosticsService struct {
	mgr *connection.ConnectionManager
}

// NewDiagnosticsService creates a new DiagnosticsService.
func NewDiagnosticsService(mgr *connection.ConnectionManager) *DiagnosticsService {
	return &DiagnosticsService{mgr: mgr}
}

// GetClusterMetrics returns real-time cluster diagnostics (controller, brokers,
// topics, partitions, under-replicated and offline partitions).
func (s *DiagnosticsService) GetClusterMetrics(connId string) (*models.ClusterMetrics, error) {
	mc, err := s.mgr.GetClient(connId)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	meta, err := mc.Admin.Metadata(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to load cluster metadata: %w", err)
	}

	return metricsFromMetadata(meta), nil
}

func metricsFromMetadata(meta kadm.Metadata) *models.ClusterMetrics {
	m := &models.ClusterMetrics{
		ClusterId:    meta.Cluster,
		ControllerId: meta.Controller,
		BrokerCount:  len(meta.Brokers),
		GeneratedAt:  time.Now().UnixMilli(),
	}

	for _, td := range meta.Topics {
		if td.Err != nil || td.IsInternal {
			continue
		}
		m.TopicCount++
		for _, p := range td.Partitions {
			m.PartitionCount++
			if len(p.ISR) < len(p.Replicas) {
				m.UnderReplicatedPartitions++
			}
			if p.Leader < 0 {
				m.OfflinePartitions++
			}
		}
	}
	return m
}

// GetBrokers lists all brokers in the cluster, marking the controller.
func (s *DiagnosticsService) GetBrokers(connId string) ([]models.BrokerInfo, error) {
	mc, err := s.mgr.GetClient(connId)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	meta, err := mc.Admin.BrokerMetadata(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to load broker metadata: %w", err)
	}

	brokers := make([]models.BrokerInfo, 0, len(meta.Brokers))
	for _, br := range meta.Brokers {
		brokers = append(brokers, models.BrokerInfo{
			Id:           br.NodeID,
			Host:         br.Host,
			Port:         br.Port,
			Rack:         derefStr(br.Rack),
			IsController: br.NodeID == meta.Controller,
		})
	}
	return brokers, nil
}

// GetBrokerConfigs returns the dynamic configuration of one broker.
func (s *DiagnosticsService) GetBrokerConfigs(connId string, brokerId int32) ([]models.ConfigEntryInfo, error) {
	mc, err := s.mgr.GetClient(connId)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	res, err := mc.Admin.DescribeBrokerConfigs(ctx, brokerId)
	if err != nil {
		return nil, err
	}
	rc, rerr := res.On(strconv.Itoa(int(brokerId)), nil)
	if rerr != nil {
		return nil, rerr
	}
	if rc.Err != nil {
		return nil, rc.Err
	}

	entries := make([]models.ConfigEntryInfo, 0, len(rc.Configs))
	for _, c := range rc.Configs {
		entries = append(entries, models.ConfigEntryInfo{
			Key:       c.Key,
			Value:     c.MaybeValue(),
			IsDefault: c.Source != kmsg.ConfigSourceDynamicBrokerConfig,
			Sensitive: c.Sensitive,
		})
	}
	return entries, nil
}

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
