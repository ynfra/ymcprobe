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
	@echo "  make build && make install     # standalone binary on PATH"
	@echo
	@echo "Full flag list: bun run src/cli.tsx --help"

.PHONY: deps
deps: ## Install dependencies
	bun install

.PHONY: build
build: ## Compile a standalone binary into dist/ (no bun needed to run it)
	@mkdir -p dist
	bun build src/cli.tsx --compile --outfile $(BIN)
	@ls -lh $(BIN)

.PHONY: install
install: build ## Build, then put the binary on PATH at PREFIX
	@mkdir -p $(PREFIX)
	install -m 755 $(BIN) $(PREFIX)/ymcprobe
	@echo "installed $(PREFIX)/ymcprobe"
	@command -v ymcprobe >/dev/null || echo "note: $(PREFIX) is not on your PATH"

.PHONY: uninstall
uninstall: ## Remove the installed binary
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
