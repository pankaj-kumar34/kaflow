package models

// BrokerInfo describes a single broker in the cluster.
type BrokerInfo struct {
	Id           int32  `json:"id"`
	Host         string `json:"host"`
	Port         int32  `json:"port"`
	Rack         string `json:"rack,omitempty"`
	IsController bool   `json:"isController"`
}

// ClusterMetrics represents real-time operational diagnostics of a Kafka cluster.
type ClusterMetrics struct {
	ClusterId                 string `json:"clusterId"`
	ControllerId              int32  `json:"controllerId"`
	BrokerCount               int    `json:"brokerCount"`
	TopicCount                int    `json:"topicCount"`
	PartitionCount            int    `json:"partitionCount"`
	UnderReplicatedPartitions int    `json:"underReplicatedPartitions"`
	OfflinePartitions         int    `json:"offlinePartitions"`
	InternalTopicCount        int    `json:"internalTopicCount"`
	GeneratedAt               int64  `json:"generatedAt"` // unix milliseconds
}
