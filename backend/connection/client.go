package connection

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/kversion"
	"github.com/twmb/franz-go/pkg/sasl"
	"github.com/twmb/franz-go/pkg/sasl/oauth"
	"github.com/twmb/franz-go/pkg/sasl/plain"
	"github.com/twmb/franz-go/pkg/sasl/scram"
	"kaflow/backend/models"
)

// ManagedClient wraps a Kafka client (data + admin) along with its
// configuration and optional SSH tunnel.
type ManagedClient struct {
	Config models.ConnectionConfig
	Client *kgo.Client
	Admin  *kadm.Client
	Tunnel *SSHTunnel
}

// BuildTLSConfig generates a *tls.Config based on user preferences.
// ServerName is left empty so franz-go (and the custom dialer) sets SNI per dialed broker.
func BuildTLSConfig(_ string, tlsCfg models.TlsConfig) (*tls.Config, error) {
	if !tlsCfg.Enabled {
		return nil, nil
	}

	tc := &tls.Config{
		InsecureSkipVerify: tlsCfg.InsecureSkipVerify,
	}

	if tlsCfg.CaCert != "" {
		caCertBytes, err := os.ReadFile(tlsCfg.CaCert)
		if err != nil {
			// CaCert might be inline PEM content rather than a file path
			caCertBytes = []byte(tlsCfg.CaCert)
		}
		caCertPool := x509.NewCertPool()
		if !caCertPool.AppendCertsFromPEM(caCertBytes) {
			return nil, fmt.Errorf("failed to parse CA certificate")
		}
		tc.RootCAs = caCertPool
	}

	if tlsCfg.ClientCert != "" && tlsCfg.ClientKey != "" {
		var cert tls.Certificate
		var err error
		// Check if file paths exist, otherwise treat as inline PEM
		if _, errF1 := os.Stat(tlsCfg.ClientCert); errF1 == nil {
			cert, err = tls.LoadX509KeyPair(tlsCfg.ClientCert, tlsCfg.ClientKey)
		} else {
			cert, err = tls.X509KeyPair([]byte(tlsCfg.ClientCert), []byte(tlsCfg.ClientKey))
		}
		if err != nil {
			return nil, fmt.Errorf("failed to load client key pair: %w", err)
		}
		tc.Certificates = []tls.Certificate{cert}
	}

	return tc, nil
}

// BuildSASLMechanism returns the franz-go SASL mechanism for the config, or nil for none.
func BuildSASLMechanism(cfg models.ConnectionConfig) (sasl.Mechanism, error) {
	switch strings.ToUpper(cfg.Sasl.Mechanism) {
	case "":
		return nil, nil
	case "PLAIN":
		return plain.Plain(func(ctx context.Context) (plain.Auth, error) {
			return plain.Auth{Zid: cfg.Username, User: cfg.Username, Pass: cfg.Password}, nil
		}), nil
	case "SCRAM-SHA-256":
		return scram.Sha256(func(ctx context.Context) (scram.Auth, error) {
			return scram.Auth{Zid: cfg.Username, User: cfg.Username, Pass: cfg.Password}, nil
		}), nil
	case "SCRAM-SHA-512":
		return scram.Sha512(func(ctx context.Context) (scram.Auth, error) {
			return scram.Auth{Zid: cfg.Username, User: cfg.Username, Pass: cfg.Password}, nil
		}), nil
	case "OAUTHBEARER":
		// static bearer token: the connection password is the token
		return oauth.Oauth(func(ctx context.Context) (oauth.Auth, error) {
			return oauth.Auth{Token: cfg.Password}, nil
		}), nil
	default:
		return nil, fmt.Errorf("unsupported SASL mechanism: %s", cfg.Sasl.Mechanism)
	}
}

// kgoOptions assembles shared client options (seed brokers, SASL, TLS/dialer).
func kgoOptions(cfg models.ConnectionConfig, customDialer func(ctx context.Context, network, addr string) (net.Conn, error), tunnel *SSHTunnel) ([]kgo.Opt, error) {
	if len(cfg.SeedBrokers) == 0 {
		return nil, fmt.Errorf("no seed brokers configured")
	}

	mechanism, err := BuildSASLMechanism(cfg)
	if err != nil {
		return nil, err
	}

	opts := []kgo.Opt{
		kgo.SeedBrokers(cfg.SeedBrokers...),
		kgo.ClientID("kaflow"),
		kgo.MaxConcurrentFetches(3),
		kgo.DialTimeout(5 * time.Second),
		kgo.RetryTimeout(8 * time.Second),
		kgo.MaxVersions(kversion.V3_9_0()),
		kgo.WithLogger(kgo.BasicLogger(os.Stderr, kgo.LogLevelWarn, nil)),
	}
	if mechanism != nil {
		opts = append(opts, kgo.SASL(mechanism))
	}

	tlsConfig, err := BuildTLSConfig(cfg.SeedBrokers[0], cfg.Tls)
	if err != nil {
		return nil, fmt.Errorf("invalid tls configuration: %w", err)
	}

	switch {
	case customDialer != nil || tunnel != nil:
		// franz-go forbids combining Dialer with DialTLSConfig, so the
		// dialer itself must wrap TLS when the connection requires it.
		base := customDialer
		if tunnel != nil && base == nil {
			base = tunnel.DialContext
		}
		opts = append(opts, kgo.Dialer(func(ctx context.Context, network, addr string) (net.Conn, error) {
			conn, err := base(ctx, network, addr)
			if err != nil {
				return nil, err
			}
			if tlsConfig != nil {
				host, _, splitErr := net.SplitHostPort(addr)
				if splitErr != nil {
					host = addr
				}
				tlsCopy := tlsConfig.Clone()
				if host != "" {
					tlsCopy.ServerName = host
				}
				tlsConn := tls.Client(conn, tlsCopy)
				if err := tlsConn.HandshakeContext(ctx); err != nil {
					_ = conn.Close()
					return nil, fmt.Errorf("tls handshake failed: %w", err)
				}
				conn = tlsConn
			}
			return conn, nil
		}))
	case tlsConfig != nil:
		opts = append(opts, kgo.DialTLSConfig(tlsConfig))
	}

	return opts, nil
}

// NewKgoClient creates a bare franz-go client for the given config with an
// optional custom dialer (used by the connection manager and by live tails).
func NewKgoClient(ctx context.Context, cfg models.ConnectionConfig, customDialer func(ctx context.Context, network, addr string) (net.Conn, error)) (*kgo.Client, *SSHTunnel, error) {
	var tunnel *SSHTunnel
	var err error

	if cfg.Ssh.Enabled {
		tunnel, err = NewSSHTunnel(cfg.Ssh)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to establish ssh tunnel: %w", err)
		}
	}

	opts, err := kgoOptions(cfg, customDialer, tunnel)
	if err != nil {
		if tunnel != nil {
			_ = tunnel.Close()
		}
		return nil, nil, err
	}

	client, err := kgo.NewClient(opts...)
	if err != nil {
		if tunnel != nil {
			_ = tunnel.Close()
		}
		return nil, nil, err
	}
	return client, tunnel, nil
}

// NewManagedClient establishes a new Kafka client according to config and
// verifies reachability with a metadata request.
func NewManagedClient(ctx context.Context, cfg models.ConnectionConfig) (*ManagedClient, error) {
	return NewManagedClientWithDialer(ctx, cfg, nil)
}

// NewManagedClientWithDialer establishes a new Kafka client with an optional custom net dialer.
func NewManagedClientWithDialer(ctx context.Context, cfg models.ConnectionConfig, customDialer func(ctx context.Context, network, addr string) (net.Conn, error)) (*ManagedClient, error) {
	client, tunnel, err := NewKgoClient(ctx, cfg, customDialer)
	if err != nil {
		return nil, err
	}

	// Verify connection with a metadata request
	pingCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()

	admin := kadm.NewClient(client)
	if _, err := admin.Metadata(pingCtx); err != nil {
		client.Close()
		if tunnel != nil {
			_ = tunnel.Close()
		}
		errMsg := err.Error()
		if strings.Contains(errMsg, "deadline exceeded") || strings.Contains(errMsg, "i/o timeout") {
			return nil, fmt.Errorf("connection timed out (context deadline exceeded): Broker could not be reached. Please check your network, VPN, firewall, or SSH tunnel settings")
		}
		return nil, fmt.Errorf("metadata request failed: %w", err)
	}

	return &ManagedClient{
		Config: cfg,
		Client: client,
		Admin:  admin,
		Tunnel: tunnel,
	}, nil
}

// Close gracefully closes the Kafka client and any underlying SSH tunnel.
func (mc *ManagedClient) Close() error {
	var errs []string

	if mc.Client != nil {
		mc.Client.Close()
	}
	if mc.Tunnel != nil {
		if err := mc.Tunnel.Close(); err != nil {
			errs = append(errs, err.Error())
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf("errors closing connection: %s", strings.Join(errs, "; "))
	}
	return nil
}
