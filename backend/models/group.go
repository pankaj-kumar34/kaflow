package models

// GroupMemberInfo identifies a member of a consumer group.
type GroupMemberInfo struct {
	MemberId   string `json:"memberId"`
	ClientId   string `json:"clientId"`
	ClientHost string `json:"clientHost"`
}

// GroupInfo holds summary information for a Kafka consumer group.
type GroupInfo struct {
	Group        string            `json:"group"`
	State        string            `json:"state"`
	ProtocolType string            `json:"protocolType"`
	Coordinator  int32             `json:"coordinator"`
	Members      []GroupMemberInfo `json:"members,omitempty"`
	Topics       []string          `json:"topics,omitempty"`
	TotalLag     int64             `json:"totalLag"`
}

// PartitionLag is the lag of a single topic-partition within a group.
type PartitionLag struct {
	Topic        string `json:"topic"`
	Partition    int32  `json:"partition"`
	Committed    int64  `json:"committed"`
	LogEndOffset int64  `json:"logEndOffset"`
	Lag          int64  `json:"lag"`
	MemberId     string `json:"memberId,omitempty"`
}

// GroupLagResult is the full lag breakdown for one consumer group.
type GroupLagResult struct {
	Group      string         `json:"group"`
	TotalLag   int64          `json:"totalLag"`
	Partitions []PartitionLag `json:"partitions"`
}
