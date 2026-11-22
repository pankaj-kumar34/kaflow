package models

// PartitionInfo holds summary information for a single topic partition.
type PartitionInfo struct {
	Id              int32   `json:"id"`
	Leader          int32   `json:"leader"`
	Replicas        []int32 `json:"replicas"`
	Isr             []int32 `json:"isr"`
	OfflineReplicas []int32 `json:"offlineReplicas"`
	LogStartOffset  int64   `json:"logStartOffset"`
	LogEndOffset    int64   `json:"logEndOffset"`
}

// TopicInfo holds summary information for a Kafka topic.
type TopicInfo struct {
	Name              string            `json:"name"`
	Partitions        int               `json:"partitions"`
	ReplicationFactor int               `json:"replicationFactor"`
	Internal          bool              `json:"internal"`
	PartitionDetails  []PartitionInfo   `json:"partitionDetails,omitempty"`
	Configs           map[string]string `json:"configs,omitempty"`
}

// ConfigEntryInfo is a single topic/broker configuration entry.
type ConfigEntryInfo struct {
	Key       string `json:"key"`
	Value     string `json:"value"`
	IsDefault bool   `json:"isDefault"`
	Sensitive bool   `json:"sensitive"`
}
