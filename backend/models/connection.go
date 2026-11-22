package models

// SshConfig holds SSH bastion tunnel credentials and connection parameters.
type SshConfig struct {
	Enabled    bool   `json:"enabled"`
	Host       string `json:"host"`
	Port       int    `json:"port"`
	User       string `json:"user"`
	Password   string `json:"password,omitempty"`
	KeyPath    string `json:"keyPath,omitempty"`
	Passphrase string `json:"passphrase,omitempty"`
}

// TlsConfig holds TLS/mTLS parameters.
type TlsConfig struct {
	Enabled            bool   `json:"enabled"`
	CaCert             string `json:"caCert,omitempty"`
	ClientCert         string `json:"clientCert,omitempty"`
	ClientKey          string `json:"clientKey,omitempty"`
	InsecureSkipVerify bool   `json:"insecureSkipVerify"`
}

// SaslConfig holds SASL authentication parameters. Username/password are
// taken from ConnectionConfig.Username/Password.
type SaslConfig struct {
	// Mechanism is "", "PLAIN", "SCRAM-SHA-256", "SCRAM-SHA-512" or "OAUTHBEARER".
	// OAUTHBEARER treats ConnectionConfig.Password as a static bearer token.
	Mechanism string `json:"mechanism,omitempty"`
}

// ConnectionConfig defines all parameters to establish a connection to a Kafka cluster.
type ConnectionConfig struct {
	Id          string     `json:"id"`
	Name        string     `json:"name"`
	SeedBrokers []string   `json:"seedBrokers"`
	Username    string     `json:"username,omitempty"`
	Password    string     `json:"password,omitempty"`
	Sasl        SaslConfig `json:"sasl"`
	Ssh         SshConfig  `json:"ssh"`
	Tls         TlsConfig  `json:"tls"`
	ReadOnly          bool       `json:"readOnly"`
	SchemaRegistryUrl string     `json:"schemaRegistryUrl,omitempty"`
	Color             string     `json:"color"`
	Group       string     `json:"group"`
	Ephemeral   bool       `json:"ephemeral,omitempty"`
}

// ConnectionStatus provides operational metadata after connecting.
type ConnectionStatus struct {
	Id           string `json:"id"`
	Connected    bool   `json:"connected"`
	LatencyMs    int64  `json:"latencyMs"`
	ClusterId    string `json:"clusterId"`
	ControllerId int32  `json:"controllerId"`
	BrokerCount  int    `json:"brokerCount"`
	TopicCount   int    `json:"topicCount"`
	ErrorMessage string `json:"errorMessage,omitempty"`
}
