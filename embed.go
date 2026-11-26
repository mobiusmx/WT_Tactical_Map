package main

import "embed"

//go:embed all:web
var EmbeddedWebFS embed.FS

//go:embed routes/routes_config.json
var EmbeddedRoutesConfig []byte

//go:embed config.json
var EmbeddedDefaultConfig []byte
