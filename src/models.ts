// Model selection.
//
// opencode has no single default model — GET /config/providers returns a
// `default` map of provider -> model for every provider you are logged into.
// A bare `--model sonnet-4.6` therefore has to be resolved against every
// authenticated provider, and the result can legitimately be ambiguous.

export type ModelInfo = {
  id: string
  providerID: string
  name?: string
  capabilities?: { toolcall?: boolean }
}

export type Providers = {
  providers: { id: string; name?: string; models: Record<string, ModelInfo> }[]
  default: Record<string, string>
}

export type Choice = { providerID: string; modelID: string; toolcall: boolean }

export class ModelError extends Error {}

/** What ymcprobe reaches for when --model is not given. Falls back to the
 *  first authenticated provider's own default if this one is not available. */
export const DEFAULT_PROVIDER = "github-copilot"
export const DEFAULT_MODEL = "gpt-5.6-terra"

function lookup(providers: Providers, providerID: string, modelID: string): Choice {
  const provider = providers.providers.find((p) => p.id === providerID)
  if (!provider) {
    const known = providers.providers.map((p) => p.id).join(", ")
    throw new ModelError(`unknown provider '${providerID}' — authenticated: ${known}`)
  }
  const model = provider.models[modelID]
  if (!model) throw new ModelError(`provider '${providerID}' has no model '${modelID}'`)
  return { providerID, modelID, toolcall: model.capabilities?.toolcall !== false }
}

/** `provider/model`, a bare model id, or a unique substring of one. */
export function resolve(providers: Providers, spec: string | undefined): Choice {
  if (spec?.includes("/")) {
    const at = spec.indexOf("/")
    return lookup(providers, spec.slice(0, at), spec.slice(at + 1))
  }

  if (!spec) {
    const preferred = providers.providers.find((p) => p.id === DEFAULT_PROVIDER)
    if (preferred?.models[DEFAULT_MODEL]) {
      return lookup(providers, DEFAULT_PROVIDER, DEFAULT_MODEL)
    }
    const first = Object.entries(providers.default)[0]
    if (!first) throw new ModelError("no authenticated providers — run `opencode auth login`")
    return lookup(providers, first[0], first[1])
  }

  const all = providers.providers.flatMap((p) => Object.values(p.models))
  const exact = all.filter((m) => m.id === spec)
  const hits = exact.length > 0 ? exact : all.filter((m) => m.id.includes(spec))

  if (hits.length === 0) throw new ModelError(`no model matches '${spec}' — try --models`)
  if (hits.length > 1) {
    // A model offered by several providers is only ambiguous if nothing
    // breaks the tie: our preferred provider first, then each provider's own
    // default.
    const ours = hits.filter((m) => m.providerID === DEFAULT_PROVIDER)
    if (ours.length === 1) return lookup(providers, ours[0]!.providerID, ours[0]!.id)

    const preferred = hits.filter((m) => providers.default[m.providerID] === m.id)
    if (preferred.length !== 1) {
      const list = hits.slice(0, 8).map((m) => `${m.providerID}/${m.id}`).join("\n  ")
      throw new ModelError(`'${spec}' is ambiguous:\n  ${list}`)
    }
    return lookup(providers, preferred[0]!.providerID, preferred[0]!.id)
  }

  return lookup(providers, hits[0]!.providerID, hits[0]!.id)
}

export function list(providers: Providers): string {
  const lines: string[] = []
  for (const provider of providers.providers) {
    const fallback = providers.default[provider.id]
    lines.push(`${provider.id}${provider.name ? `  (${provider.name})` : ""}`)
    for (const model of Object.values(provider.models)) {
      const marks = [
        model.id === fallback ? "default" : "",
        model.capabilities?.toolcall === false ? "no tools" : "",
      ].filter(Boolean).join(", ")
      lines.push(`  ${model.id}${marks ? `  [${marks}]` : ""}`)
    }
    lines.push("")
  }
  return lines.join("\n")
}
