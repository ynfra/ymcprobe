# ymcprobe — see `make` or `make help` for the target list.
#
# Targets are documented with a trailing `## comment`; `help` extracts them,
# so a new target shows up in the listing the moment it is written.
#
# `json` and `models` are prefixed with @ because their stdout is meant to be
# piped — make's own command echo would otherwise land in front of the JSON.

URL    ?= http://127.0.0.1:8080/mcp
PORT   ?= 8080
ARGS   ?=
PREFIX ?= $(HOME)/.local/bin
BIN    := dist/ymcprobe

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@echo "ymcprobe — chat against remote MCP servers and watch the tool calls"
	@echo
	@echo "Usage: make <target> [URL=<mcp-url>] [ARGS='<flags>']"
	@echo
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'
	@echo
	@echo "Variables:"
	@echo "  URL     MCP server to probe          (default: $(URL))"
	@echo "  PORT    port for the fixture server  (default: $(PORT))"
	@echo "  ARGS    extra flags passed through   (e.g. ARGS='-m glm-5.3')"
	@echo "  PREFIX  where install puts the binary (default: $(PREFIX))"
	@echo
	@echo "Examples:"
	@echo "  make run URL=http://localhost:8787/mcp"
	@echo "  make web URL=http://localhost:8787/mcp ARGS='--all-tools'"
	@echo "  make fixture PORT=8081 &"
	@echo "  make install                   # dependencies"
	@echo "  make link                      # ymcprobe on PATH, symlinked to dist/"
	@echo "  make distribute                # ymcprobe on PATH, copied"
	@echo
	@echo "Full flag list: bun run src/cli.tsx --help"

.PHONY: install
install: ## Install dependencies
	bun install

.PHONY: build
build: ## Compile a standalone binary into dist/ (no bun needed to run it)
	@mkdir -p dist
	bun build src/cli.tsx --compile --outfile $(BIN)
	@ls -lh $(BIN)

.PHONY: link
link: build ## Symlink the built binary into PREFIX — rebuilds are picked up
	@mkdir -p $(PREFIX)
	ln -sf $(abspath $(BIN)) $(PREFIX)/ymcprobe
	@echo "linked $(PREFIX)/ymcprobe -> $(BIN)"
	@command -v ymcprobe >/dev/null || echo "note: $(PREFIX) is not on your PATH"

.PHONY: distribute
distribute: build ## Copy the built binary into PREFIX — survives deleting this tree
	@mkdir -p $(PREFIX)
	@# Drop any existing entry first: over a `make link` symlink, install(1)
	@# follows it and refuses with "are the same file".
	@rm -f $(PREFIX)/ymcprobe
	install -m 755 $(BIN) $(PREFIX)/ymcprobe
	@echo "copied $(BIN) -> $(PREFIX)/ymcprobe"
	@command -v ymcprobe >/dev/null || echo "note: $(PREFIX) is not on your PATH"

.PHONY: uninstall
uninstall: ## Remove whatever link or distribute put at PREFIX
	rm -f $(PREFIX)/ymcprobe

.PHONY: run
run: ## Start the TUI against URL
	bun run src/cli.tsx $(URL) $(ARGS)

.PHONY: web
web: ## Start the browser UI against URL
	bun run src/cli.tsx $(URL) --web $(ARGS)

.PHONY: json
json: ## Print URL's advertised tools as JSON, no LLM
	@bun run src/cli.tsx $(URL) --json $(ARGS)

.PHONY: models
models: ## List authenticated providers and their models
	@bun run src/cli.tsx --models

.PHONY: fixture
fixture: ## Run the bundled 4-tool MCP server on PORT
	PORT=$(PORT) bun run fixtures/echo-mcp.ts

.PHONY: preview
preview: ## Render the TUI against scripted events, no LLM spend
	bun run src/preview.tsx

.PHONY: smoke
smoke: ## End-to-end check that tool events still arrive (needs a fixture, costs one LLM call)
	bun run src/smoke.ts

.PHONY: typecheck
typecheck: ## Type check
	bunx tsc --noEmit
