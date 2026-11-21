package services

import (
	"context"
	"fmt"
	"time"

	"github.com/twmb/franz-go/pkg/kadm"
	"kaflow/backend/connection"
	"kaflow/backend/models"
)

// GroupService exposes Kafka consumer group inspection and offset resets to the frontend.
type GroupService struct {
	mgr *connection.ConnectionManager
}

// NewGroupService creates a new GroupService.
func NewGroupService(mgr *connection.ConnectionManager) *GroupService {
	return &GroupService{mgr: mgr}
}

// groupInfoFromLag converts a kadm described group + lag into the frontend model.
func groupInfoFromLag(l kadm.DescribedGroupLag) models.GroupInfo {
	info := models.GroupInfo{
		Group:        l.Group,
		State:        l.State,
		ProtocolType: l.ProtocolType,
		TotalLag:     l.Lag.Total(),
		Coordinator:  l.Coordinator.NodeID,
	}
	for _, m := range l.Members {
		info.Members = append(info.Members, models.GroupMemberInfo{
			MemberId:   m.MemberID,
			ClientId:   m.ClientID,
			ClientHost: m.ClientHost,
		})
	}
	topicSet := make(map[string]bool)
	for _, m := range l.Lag.Sorted() {
		topicSet[m.Topic] = true
	}
	for t := range topicSet {
		info.Topics = append(info.Topics, t)
	}
	return info
}

// ListGroups returns all consumer groups with state, members and total lag.
func (s *GroupService) ListGroups(connId string) ([]models.GroupInfo, error) {
	mc, err := s.mgr.GetClient(connId)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	listed, err := mc.Admin.ListGroups(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list consumer groups: %w", err)
	}

	groups := make([]string, 0, len(listed))
	for _, g := range listed {
		groups = append(groups, g.Group)
	}
	if len(groups) == 0 {
		return []models.GroupInfo{}, nil
	}

	lags, err := mc.Admin.Lag(ctx, groups...)
	if err != nil {
		return nil, fmt.Errorf("failed to compute group lag: %w", err)
	}

	result := make([]models.GroupInfo, 0, len(groups))
	for _, l := range lags.Sorted() {
		result = append(result, groupInfoFromLag(l))
	}
	return result, nil
}

// GetGroupLag returns the per-partition lag breakdown for one group.
func (s *GroupService) GetGroupLag(connId string, group string) (*models.GroupLagResult, error) {
	mc, err := s.mgr.GetClient(connId)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	lags, err := mc.Admin.Lag(ctx, group)
	if err != nil {
		return nil, fmt.Errorf("failed to compute group lag: %w", err)
	}
	l, ok := lags[group]
	if !ok {
		return nil, fmt.Errorf("group %s not found", group)
	}

	result := &models.GroupLagResult{
		Group:      group,
		TotalLag:   l.Lag.Total(),
		Partitions: []models.PartitionLag{},
	}
	for _, m := range l.Lag.Sorted() {
		pl := models.PartitionLag{
			Topic:        m.Topic,
			Partition:    m.Partition,
			Committed:    m.Commit.At,
			LogEndOffset: m.End.Offset,
			Lag:          m.Lag,
		}
		if m.Member != nil {
			pl.MemberId = m.Member.MemberID
		}
		result.Partitions = append(result.Partitions, pl)
	}
	return result, nil
}

// ResetGroupOffsets resets a group's committed offsets for all its assigned
// partitions to earliest, latest, or a given timestamp (unix ms).
func (s *GroupService) ResetGroupOffsets(connId string, group string, resetTo string, timestamp int64) error {
	mc, err := s.mgr.GetClient(connId)
	if err != nil {
		return err
	}
	if mc.Config.ReadOnly {
		return fmt.Errorf("connection is in read-only mode")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Discover topics from committed offsets first (empty groups have no active members
	// in DescribeGroups.JoinTopics, yet Kafka requires an empty group to reset offsets).
	topicSet := make(map[string]struct{})
	if fetched, fetchErr := mc.Admin.FetchOffsets(ctx, group); fetchErr == nil {
		for topic := range fetched {
			topicSet[topic] = struct{}{}
		}
	}
	if len(topicSet) == 0 {
		descs, err := mc.Admin.DescribeGroups(ctx, group)
		if err != nil {
			return fmt.Errorf("failed to describe group: %w", err)
		}
		dg, ok := descs[group]
		if !ok || dg.Err != nil {
			return fmt.Errorf("group %s not found", group)
		}
		for _, t := range dg.JoinTopics() {
			topicSet[t] = struct{}{}
		}
	}
	if len(topicSet) == 0 {
		return fmt.Errorf("group %s has no committed or assigned topics", group)
	}
	topics := make([]string, 0, len(topicSet))
	for t := range topicSet {
		topics = append(topics, t)
	}

	var listed kadm.ListedOffsets
	switch resetTo {
	case "earliest":
		listed, err = mc.Admin.ListStartOffsets(ctx, topics...)
	case "latest":
		listed, err = mc.Admin.ListEndOffsets(ctx, topics...)
	case "timestamp":
		listed, err = mc.Admin.ListOffsetsAfterMilli(ctx, timestamp, topics...)
	default:
		return fmt.Errorf("invalid reset target %q (use earliest, latest or timestamp)", resetTo)
	}
	if err != nil {
		return fmt.Errorf("failed to list offsets: %w", err)
	}

	if _, err := mc.Admin.CommitOffsets(ctx, group, listed.Offsets()); err != nil {
		return fmt.Errorf("offset reset failed (group must not have active members): %w", err)
	}
	return nil
}
