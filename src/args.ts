export type ServerSpec = { name: string; url: string }

export type Options = {
  servers: ServerSpec[]
  headers: Record<string, string>
  port: number
  model?: string
  system?: string
  noSystem: boolean
  allTools: boolean
  json: boolean
  listModels: boolean
  web: boolean
}

const USAGE = `ymcprobe — chat against remote MCP servers and watch the tool calls

Usage:
  ymcprobe <mcp-url>... [options]
  ymcprobe <name>=<mcp-url>... [options]

Options:
  -H, --header 'K: V'   header sent to every MCP server (repeatable)
  -m, --model <model>   model id, or provider/model to disambiguate
      --models          list authenticated providers and models, then exit
  -p, --port <n>        port for the spawned opencode server (default: 4179)
      --system <text>   replace the system prompt that nudges tool use
      --no-system       send no system prompt at all
      --all-tools       keep opencode's built-in tools (bash, read, edit, ...)
      --web             serve a browser UI instead of the TUI
      --json            list every server's tools as JSON and exit
  -h, --help            show this help

Examples:
  ymcprobe http://localhost:8080/mcp
  ymcprobe local=http://localhost:8080/mcp gh=https://mcp.example.com/mcp
  ymcprobe https://mcp.example.com/mcp -H 'Authorization: Bearer $TOKEN'
  ymcprobe http://localhost:8080/mcp --web
  ymcprobe http://localhost:8080/mcp -m gpt-5.6-terra
`

/** opencode prefixes MCP tools as <name>_<tool>, so names must be terse and
 *  unique. An explicit `name=url` wins; otherwise derive one from the host. */
function nameFor(url: string, taken: Set<string>): string {
  let base: string
  try {
    const host = new URL(url).hostname
    base = (host === "localhost" || /^[\d.]+$/.test(host) ? "local" : host.split(".")[0]!)
      .replace(/[^a-zA-Z0-9]/g, "")
      .toLowerCase() || "mcp"
  } catch {
    base = "mcp"
  }
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`
}

export function parse(argv: string[]): Options | { help: string } {
  const opts: Options = {
    servers: [],
    headers: {},
    port: 4179,
    noSystem: false,
    allTools: false,
    json: false,
    listModels: false,
    web: false,
  }

  const positional: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const next = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`${arg} needs a value`)
      return v
    }

    switch (arg) {
      case "-h": case "--help": return { help: USAGE }
      case "-H": case "--header": {
        const [key, ...rest] = next().split(":")
        if (!key || rest.length === 0) throw new Error("--header wants 'Key: value'")
        opts.headers[key.trim()] = rest.join(":").trim()
        break
      }
      case "-m": case "--model": opts.model = next(); break
      case "-p": case "--port": opts.port = Number(next()); break
      case "--system": opts.system = next(); break
      case "--no-system": opts.noSystem = true; break
      case "--all-tools": opts.allTools = true; break
      case "--web": opts.web = true; break
      case "--json": opts.json = true; break
      case "--models": opts.listModels = true; break
      default:
        if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`)
        positional.push(arg)
    }
  }

  const taken = new Set<string>()
  for (const entry of positional) {
    // `name=url`, but only when the part before `=` is not itself a scheme.
    const eq = entry.indexOf("=")
    const explicit = eq > 0 && !entry.slice(0, eq).includes(":")
    const name = explicit ? entry.slice(0, eq) : ""
    const url = explicit ? entry.slice(eq + 1) : entry

    if (!/^https?:\/\//.test(url)) throw new Error(`not an http(s) url: ${url}`)
    const final = name || nameFor(url, taken)
    if (taken.has(final)) throw new Error(`duplicate server name: ${final}`)
    taken.add(final)
    opts.servers.push({ name: final, url })
  }

  if (opts.servers.length === 0 && !opts.listModels) return { help: USAGE }
  return opts
}
