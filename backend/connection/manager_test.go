package connection

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zalando/go-keyring"
	"kaflow/backend/models"
)

func TestConnectionManager_SaveAndLoad(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	keyring.MockInit()

	cm := NewConnectionManager()
	require.NotNil(t, cm)

	cfg := models.ConnectionConfig{
		SeedBrokers: []string{"broker-1:9092", " broker-2:9092 ", ""},
		Password:    "secret-password",
		Sasl:        models.SaslConfig{Mechanism: "SCRAM-SHA-512"},
		Ssh:         models.SshConfig{Enabled: true, Host: "bastion", Password: "ssh-secret-password", Passphrase: "ssh-key-passphrase"},
	}

	// Save new connection (should generate UUID, trim brokers, default Name)
	err := cm.SaveConnection(cfg)
	require.NoError(t, err)

	saved := cm.GetSavedConnections()
	require.Len(t, saved, 1)
	savedCfg := saved[0]
	assert.NotEmpty(t, savedCfg.Id)
	assert.Equal(t, []string{"broker-1:9092", "broker-2:9092"}, savedCfg.SeedBrokers)
	assert.Equal(t, "broker-1:9092,broker-2:9092", savedCfg.Name)
	assert.Equal(t, "SCRAM-SHA-512", savedCfg.Sasl.Mechanism)

	// The on-disk copy must be redacted (secrets live only in the keyring)
	disk, err := os.ReadFile(filepath.Join(os.Getenv("HOME"), ".kaflow", "connections.json"))
	require.NoError(t, err)
	assert.NotContains(t, string(disk), "secret-password")
	assert.NotContains(t, string(disk), "ssh-secret-password")
	assert.NotContains(t, string(disk), "ssh-key-passphrase")

	// New manager instance reloads from disk and re-attaches keyring secrets
	cm2 := NewConnectionManager()
	saved2 := cm2.GetSavedConnections()
	require.Len(t, saved2, 1)
	assert.Equal(t, savedCfg.Id, saved2[0].Id)
	assert.Equal(t, "secret-password", saved2[0].Password)
	assert.Equal(t, "ssh-secret-password", saved2[0].Ssh.Password)
	assert.Equal(t, "ssh-key-passphrase", saved2[0].Ssh.Passphrase)

	// Delete removes profile and keyring entry
	require.NoError(t, cm2.DeleteConnection(savedCfg.Id))
	assert.Len(t, cm2.GetSavedConnections(), 0)

	secret, err := keyring.Get("kaflow", savedCfg.Id)
	require.Error(t, err)
	assert.Empty(t, secret)
}

func TestConnectionManager_EphemeralNotPersisted(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	keyring.MockInit()

	cm := NewConnectionManager()
	err := cm.SaveConnection(models.ConnectionConfig{
		Id:        "eph-1",
		Name:      "Ephemeral",
		Ephemeral: true,
	})
	require.NoError(t, err)

	cm2 := NewConnectionManager()
	assert.Len(t, cm2.GetSavedConnections(), 0)
}

func TestBuildSASLMechanism(t *testing.T) {
	mech, err := BuildSASLMechanism(models.ConnectionConfig{Sasl: models.SaslConfig{Mechanism: "nonsense"}})
	require.Error(t, err)
	assert.Nil(t, mech)

	mech, err = BuildSASLMechanism(models.ConnectionConfig{})
	require.NoError(t, err)
	assert.Nil(t, mech)

	mech, err = BuildSASLMechanism(models.ConnectionConfig{Sasl: models.SaslConfig{Mechanism: "plain"}})
	require.NoError(t, err)
	assert.Equal(t, "PLAIN", mech.Name())
}

func TestBuildTLSConfig(t *testing.T) {
	tc, err := BuildTLSConfig("broker:9092", models.TlsConfig{Enabled: false})
	require.NoError(t, err)
	assert.Nil(t, tc)

	tc, err = BuildTLSConfig("broker:9092", models.TlsConfig{Enabled: true})
	require.NoError(t, err)
	assert.Empty(t, tc.ServerName)
}
