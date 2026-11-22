//go:build integration

package services

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/zalando/go-keyring"
	"kaflow/backend/connection"
	"kaflow/backend/models"
)

func TestKafkaIntegration_FetchAndTail(t *testing.T) {
	broker := os.Getenv("KAFLOW_TEST_BROKER")
	if broker == "" {
		broker = "localhost:9092"
	}

	t.Setenv("HOME", t.TempDir())
	keyring.MockInit()
	mgr := connection.NewConnectionManager()
	cfg := models.ConnectionConfig{
		Id:          "it-conn",
		Name:        "integration",
		SeedBrokers: []string{broker},
	}
	mc, err := connection.NewManagedClient(context.Background(), cfg, nil)
	require.NoError(t, err)
	mgr.SetActiveClient(cfg.Id, mc)
	t.Cleanup(func() { mc.Close() })

	topic := fmt.Sprintf("kaflow-it-%d", time.Now().UnixNano())
	ts := NewTopicService(mgr)
	require.NoError(t, ts.CreateTopic(cfg.Id, topic, 1, 1, nil))
	t.Cleanup(func() { _ = ts.DeleteTopic(cfg.Id, topic) })

	ms := NewMessageService(mgr)
	require.NoError(t, ms.ProduceMessage(cfg.Id, topic, 0, "k1", `{"ok":true}`, nil))

	res, err := ms.FetchMessages(cfg.Id, topic, -1, -1, 10)
	require.NoError(t, err)
	require.Len(t, res.Messages, 1)
	require.Equal(t, "k1", res.Messages[0].Key)

	tails := NewTailService(mgr)
	require.NoError(t, tails.StartTail(cfg.Id, topic, -1, false))
	require.True(t, tails.IsTailing(cfg.Id))
	require.NoError(t, tails.StopTail(cfg.Id))
	require.False(t, tails.IsTailing(cfg.Id))
}
