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
BIN    := ymcprobe

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
	@echo "  make distribute                # build, then ymcprobe on PATH"
	@echo "  make clean                     # drop the binary and build scratch"
	@echo
	@echo "Full flag list: bun run src/cli.tsx --help"

.PHONY: install
install: ## Install dependencies
	bun install

.PHONY: build
build: ## Compile the standalone binary ./ymcprobe (no bun needed to run it)
	bun build src/cli.tsx --compile --outfile $(BIN)
	@# `bun build --compile` leaves a 63 MB .<hash>-00000000.bun-build scratch
	@# file behind on every run. Sweep them here, not only in `clean`, or a
	@# handful of rebuilds quietly costs a gigabyte.
	@rm -f .*.bun-build
	@ls -lh $(BIN)

.PHONY: distribute
distribute: build ## Symlink ./ymcprobe into PREFIX so it is on PATH
	@mkdir -p $(PREFIX)
	ln -sf $(abspath $(BIN)) $(PREFIX)/ymcprobe
	@echo "linked $(PREFIX)/ymcprobe -> $(abspath $(BIN))"
	@command -v ymcprobe >/dev/null || echo "note: $(PREFIX) is not on your PATH"

.PHONY: uninstall
uninstall: ## Remove what distribute put at PREFIX
	rm -f $(PREFIX)/ymcprobe

.PHONY: clean
clean: ## Remove the binary and any leftover build scratch files
	rm -f $(BIN) .*.bun-build
	@echo "cleaned"

.PHONY: distclean
distclean: clean ## clean, plus node_modules
	rm -rf node_modules

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
