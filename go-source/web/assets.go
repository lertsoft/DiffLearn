package webassets

import "embed"

// Assets bundles the web UI files into the binary.
//go:embed index.html app.js styles.css
var Assets embed.FS
