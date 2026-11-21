module kaflow

go 1.26.0

require (
	github.com/google/uuid v1.6.0
	github.com/stretchr/testify v1.12.1
	github.com/twmb/franz-go v1.22.3
	github.com/twmb/franz-go/pkg/kadm v1.20.0
	github.com/twmb/franz-go/pkg/kmsg v1.15.1
	github.com/wailsapp/wails/v3 v3.0.0
	github.com/zalando/go-keyring v0.2.6
	golang.org/x/crypto v0.58.0
)

require (
	al.essio.dev/pkg/shellescape v1.6.0 // indirect
	github.com/adrg/xdg v0.5.3 // indirect
	github.com/coder/websocket v1.8.14 // indirect
	github.com/danieljoos/wincred v1.2.3 // indirect
	github.com/go-ole/go-ole v1.3.0 // indirect
	github.com/godbus/dbus/v5 v5.2.2 // indirect
	github.com/klauspost/compress v1.20.3 // indirect
	github.com/mattn/go-colorable v0.1.14 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/pierrec/lz4/v4 v4.1.33 // indirect
	go.yaml.in/yaml/v3 v3.0.5 // indirect
	golang.org/x/sys v0.49.0 // indirect
)

replace github.com/danieljoos/wincred => ./third_party/wincred
