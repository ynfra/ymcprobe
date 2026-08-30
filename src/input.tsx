import { useRef } from "react"
import { Text, useInput } from "ink"

const DEL = "\x7f"  // what macOS Terminal sends for Backspace
const BS = "\x08"   // what most other terminals send

/** A single-line text input.
 *
 *  Not ink-text-input, for two reasons found by testing it:
 *
 *  1. Ink only sets `key.backspace` / `key.delete` when a rub-out arrives
 *     alone in its own read. Hold the key down, or paste, and the chunk comes
 *     through as raw 0x7f bytes with no flag set at all — so the characters
 *     have to be handled in `input` too.
 *  2. `useInput`'s callback closes over the value from its render, so two
 *     events landing before React re-renders both see the same text and only
 *     one deletion survives. A ref updated synchronously keeps them composing.
 */
export function Input(props: {
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  disabled?: boolean
}) {
  const latest = useRef(props.value)
  latest.current = props.value

  const set = (next: string) => {
    latest.current = next
    props.onChange(next)
  }

  useInput((input, key) => {
    if (props.disabled) return

    if (key.return) { props.onSubmit(latest.current); return }
    if (key.backspace || key.delete) { set(latest.current.slice(0, -1)); return }

    if (key.ctrl && input === "u") { set(""); return }
    if (key.ctrl && input === "w") { set(latest.current.replace(/\s*\S+\s*$/, "")); return }

    if (key.ctrl || key.meta || key.escape || key.tab) return
    if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return

    // A chunk can mix printable characters and rub-outs, so walk it.
    let next = latest.current
    for (const char of input) {
      if (char === DEL || char === BS) next = next.slice(0, -1)
      else if (char === "\r" || char === "\n") continue
      else if (char === "\t") next += " "
      else next += char
    }
    if (next !== latest.current) set(next)
  })

  return (
    <Text>
      {props.value}
      {!props.disabled && <Text inverse> </Text>}
    </Text>
  )
}
