package services

import (
	"bytes"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/zalando/go-keyring"
	"kaflow/backend/connection"
	"kaflow/backend/models"
)

func newReadOnlyTestMgr(t *testing.T) (*connection.ConnectionManager, string) {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	keyring.MockInit()
	mgr := connection.NewConnectionManager()
	id := "ro-conn"
	mgr.SetActiveClient(id, &connection.ManagedClient{
		Config: models.ConnectionConfig{Id: id, ReadOnly: true},
	})
	return mgr, id
}

func TestServices_ReadOnlyGuards(t *testing.T) {
	mgr, id := newReadOnlyTestMgr(t)

	ts := NewTopicService(mgr)
	require.ErrorContains(t, ts.CreateTopic(id, "t", 1, 1, nil), "read-only")
	require.ErrorContains(t, ts.DeleteTopic(id, "t"), "read-only")
	require.ErrorContains(t, ts.IncreasePartitions(id, "t", 1), "read-only")
	require.ErrorContains(t, ts.UpdateTopicConfig(id, "t", "k", "v"), "read-only")

	ms := NewMessageService(mgr)
	require.ErrorContains(t, ms.ProduceMessage(id, "t", -1, "k", "v", nil), "read-only")

	gs := NewGroupService(mgr)
	require.ErrorContains(t, gs.ResetGroupOffsets(id, "g", "earliest", 0), "read-only")
}

func TestTailService_IdleLifecycle(t *testing.T) {
	mgr, id := newReadOnlyTestMgr(t)
	tail := NewTailService(mgr)

	assert.False(t, tail.IsTailing(id))
	require.NoError(t, tail.StopTail(id))
	assert.False(t, tail.IsTailing(id))
}

func TestMetricsFromMetadata_ExcludesInternalTopics(t *testing.T) {
	meta := kadm.Metadata{
		Cluster:    "cluster-1",
		Controller: 1,
		Brokers:    kadm.BrokerDetails{{NodeID: 1}},
		Topics: kadm.TopicDetails{
			"orders": {
				Topic: "orders",
				Partitions: kadm.PartitionDetails{
					0: {Leader: 1, Replicas: []int32{1, 2}, ISR: []int32{1, 2}},
				},
			},
			"payments": {
				Topic: "payments",
				Partitions: kadm.PartitionDetails{
					0: {Leader: 1, Replicas: []int32{1, 2}, ISR: []int32{1}},
				},
			},
			"__consumer_offsets": {
				Topic:      "__consumer_offsets",
				IsInternal: true,
				Partitions: kadm.PartitionDetails{
					0: {Leader: -1, Replicas: []int32{1}, ISR: []int32{}},
				},
			},
			"broken": {
				Topic: "broken",
				Err:   errors.New("load failed"),
			},
		},
	}

	m := metricsFromMetadata(meta)
	assert.Equal(t, 1, m.BrokerCount)
	assert.Equal(t, 2, m.TopicCount)
	assert.Equal(t, 0, m.InternalTopicCount)
	assert.Equal(t, 2, m.PartitionCount)
	assert.Equal(t, 1, m.UnderReplicatedPartitions)
	assert.Equal(t, 0, m.OfflinePartitions)
}

func TestRecordToModel_CapsAndWireFormat(t *testing.T) {
	// 1. Large UTF-8 payload is capped at maxRecordValueBytes
	big := bytes.Repeat([]byte("a"), maxRecordValueBytes+100)
	recBig := recordToModel(&kgo.Record{Topic: "t", Value: big})
	assert.True(t, recBig.Truncated)
	assert.Equal(t, maxRecordValueBytes+100, recBig.Size)
	assert.Len(t, recBig.Value, maxRecordValueBytes)

	// 2. Confluent wire header (0x00 + big-endian schema ID 42) strips header for JSON
	wireJson := append([]byte{0x00, 0x00, 0x00, 0x00, 42}, []byte(`{"ok":true}`)...)
	recWire := recordToModel(&kgo.Record{Topic: "t", Value: wireJson})
	assert.Equal(t, uint32(42), recWire.SchemaId)
	assert.False(t, recWire.Binary)
	assert.Equal(t, `{"ok":true}`, recWire.Value)

	// 3. Binary non-UTF8 payload formats as base64 + hex
	wireBin := []byte{0x00, 0x00, 0x00, 0x00, 7, 0xff, 0xfe, 0x01}
	recBin := recordToModel(&kgo.Record{Topic: "t", Value: wireBin})
	assert.Equal(t, uint32(7), recBin.SchemaId)
	assert.True(t, recBin.Binary)
	assert.Contains(t, recBin.Value, "Base64:")
	assert.Contains(t, recBin.Value, "Hex:")
}
