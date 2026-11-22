package models

// MessageHeader is a single Kafka record header.
type MessageHeader struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// MessageRecord is a single Kafka record as displayed in the message browser.
type MessageRecord struct {
	Topic     string          `json:"topic"`
	Partition int32           `json:"partition"`
	Offset    int64           `json:"offset"`
	Timestamp int64           `json:"timestamp"` // unix milliseconds
	Key       string          `json:"key"`
	Value     string          `json:"value"`
	Headers   []MessageHeader `json:"headers,omitempty"`
	Size      int             `json:"size,omitempty"`
	Truncated bool            `json:"truncated,omitempty"`
	SchemaId  uint32          `json:"schemaId,omitempty"`
	Binary    bool            `json:"binary,omitempty"`
}

// SchemaInfo holds a schema fetched from a Confluent-compatible Schema Registry.
type SchemaInfo struct {
	Id         uint32 `json:"id"`
	SchemaType string `json:"schemaType"`
	Schema     string `json:"schema"`
}

// FetchResult is the result of a bounded fetch from one topic.
type FetchResult struct {
	Topic       string          `json:"topic"`
	Partition   int32           `json:"partition"` // -1 when fetching across all partitions
	Messages    []MessageRecord `json:"messages"`
	StartOffset int64           `json:"startOffset"` // log start offset of the requested partition (or oldest of all)
	EndOffset   int64           `json:"endOffset"`   // high watermark of the requested partition (or newest of all)
}

// MessageEvent is emitted to the frontend while live-tailing a topic.
type MessageEvent struct {
	MessageRecord
	ConnId string `json:"connId"`
}
