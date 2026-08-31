BIN     := ymcprobe
ENTRY   := src/cli.tsx
BIN_DIR := $(HOME)/.local/bin

# Defaults for the targets that actually talk to an MCP server.
URL     ?= http://127.0.0.1:8080/mcp
PORT    ?= 8080
ARGS    ?=

.PHONY: help install build link ship uninstall clean run web json models fixture preview smoke typecheck

.DEFAULT_GOAL := help

############################################################
# HELP #####################################################
############################################################
help:
	@awk 'BEGIN {FS = ":.*##"; printf "Usage:\n  make \033[36m<target>\033[0m [URL=<mcp-url>] [ARGS=<flags>]\n\nTargets:\n"}'
	@grep -h -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@printf "\nVariables:\n"
	@printf "  \033[36m%-20s\033[0m %s\n" "URL"  "MCP server to probe (default: $(URL))"
	@printf "  \033[36m%-20s\033[0m %s\n" "PORT" "port for the fixture server (default: $(PORT))"
	@printf "  \033[36m%-20s\033[0m %s\n" "ARGS" "extra flags, e.g. ARGS='-m gpt-5.6-terra --all-tools'"
	@printf "\nFull flag list: bun run $(ENTRY) --help\n"

############################################################
# BUILD ####################################################
############################################################
install: ## Install dependencies
	bun install

build: ## Compile a standalone binary
	bun build $(ENTRY) --compile --minify --outfile $(BIN)
	@# --compile leaves a 63 MB .<hash>-00000000.bun-build behind every run.
	@rm -f .*.bun-build

link: ## Symlink the compiled binary onto the PATH
	mkdir -p $(BIN_DIR)
	ln -sf $(CURDIR)/$(BIN) $(BIN_DIR)/$(BIN)
	@echo "linked $(BIN_DIR)/$(BIN) -> $(CURDIR)/$(BIN)"

ship: build link ## Build then link (the usual "ship a new version" target)

uninstall: ## Remove the symlink from the PATH
	rm -f $(BIN_DIR)/$(BIN)

clean: ## Remove the compiled binary and build artifacts
	rm -f $(BIN) .*.bun-build

############################################################
# RUN ######################################################
############################################################
run: ## Start the TUI against URL
	bun run $(ENTRY) $(URL) $(ARGS)

web: ## Start the browser UI against URL
	bun run $(ENTRY) $(URL) --web $(ARGS)

json: ## Print URL's advertised tools as JSON, no LLM
	@bun run $(ENTRY) $(URL) --json $(ARGS)

models: ## List authenticated providers and their models
	@bun run $(ENTRY) --models

fixture: ## Run the bundled 4-tool MCP server on PORT
	PORT=$(PORT) bun run fixtures/echo-mcp.ts

############################################################
# CHECK ####################################################
############################################################
preview: ## Render the TUI against scripted events, no LLM spend
	bun run src/preview.tsx

smoke: ## End-to-end check that tool events arrive (needs a fixture, one LLM call)
	bun run src/smoke.ts

typecheck: ## Type-check without emitting
	bun tsc --noEmit
