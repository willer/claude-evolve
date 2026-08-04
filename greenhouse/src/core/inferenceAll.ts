// Parser for the production signal table in `<root>/inference-all` (the trading-strategies
// launcher). Pure + tested; the Poller only supplies the file text.
//
// Each LIVE signal is a python tuple `("<dir>", "<sym>", "<tf>", [flags...])` and may span
// several lines. A leading `#` comments a signal OUT — those are not live, hence not pinned.
//
// Two pin shapes exist, and they are NOT interchangeable:
//   solo   ("ev-1d-soxl", …, ["--pin=gen823-001"])            -> that workspace is pinned
//   MIXED  ("ev-1d-tqqq-high+ev-1d-htqqq", …,                 -> ONE webhook averaging two
//            ["--pin=ev-1d-htqqq:gen78-001",                     workspaces' signals; each leg
//             "--pin=ev-1d-tqqq-high:gen246-011"])              carries its OWN pin, qualified
//                                                                by workspace name.
// A blend's `+`-joined dir field names every member, so a workspace can appear in production
// without owning the entry — that membership is what the dashboard must show alongside the pin.

import type { ProductionSignal } from './types';

/** Strip a `#` comment tail, respecting double-quoted strings (dir/symbol/flags are quoted,
 *  and a comment can legitimately quote a `--pin=` that is NOT in force). */
function stripComment(line: string): string {
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inStr = !inStr;
    else if (c === '#' && !inStr) return line.slice(0, i);
  }
  return line;
}

const depthOf = (s: string): number =>
  (s.match(/\(/g)?.length ?? 0) - (s.match(/\)/g)?.length ?? 0);

/** Turn one complete tuple's text into per-workspace entries. */
function commit(entry: string, out: Map<string, ProductionSignal>): void {
  const dir = entry.match(/^\s*\(\s*"([^"]+)"/);
  if (!dir) return;
  // `+` joins the members of a MIXED signal; a solo entry is just a one-member list.
  const members = dir[1]
    .split('+')
    .map((m) => m.trim())
    .filter(Boolean);
  if (!members.length) return;

  const signalName = entry.match(/--signal-name=([^"\s,]+)/)?.[1] ?? null;

  // Qualified pins (`<workspace>:<algo>`) bind to one member; an unqualified pin binds to all.
  const qualified = new Map<string, string>();
  let unqualified: string | null = null;
  for (const m of entry.matchAll(/--pin=([^"\s,]+)/g)) {
    const [a, b] = m[1].split(':');
    if (b) qualified.set(a, b);
    else unqualified = a;
  }

  for (const name of members) {
    out.set(name, { signalName, members, pin: qualified.get(name) ?? unqualified });
  }
}

/** Map every workspace named by a LIVE inference-all signal to its production signal:
 *  the signal name, every workspace blended into it, and the algo id production pins it to
 *  (null when production deploys the best-by-performance champion). Workspaces absent from
 *  the map are not in production at all. */
export function parseInferenceAll(text: string): Map<string, ProductionSignal> {
  const out = new Map<string, ProductionSignal>();
  let buf = '';
  let depth = 0;
  for (const raw of text.split('\n')) {
    const line = stripComment(raw);
    if (!line.trim()) continue;
    if (depth === 0) {
      if (!/^\s*\(\s*"/.test(line)) continue; // only a tuple opens an entry
      buf = line;
      depth = depthOf(line);
    } else {
      buf += ' ' + line;
      depth += depthOf(line);
    }
    if (depth <= 0) {
      commit(buf, out);
      buf = '';
      depth = 0;
    }
  }
  return out;
}

/** A pill for the detail view's Leader heading. `cls` maps to the `.tag-*` CSS classes. */
export interface ProductionTag {
  cls: 'winner' | 'prev' | 'mix';
  text: string;
  title: string;
}

/** Pills describing how production deploys workspace `name`, given the R&D leader shown on
 *  screen. Blend membership comes FIRST because it changes what "deployed" even means — the
 *  workspace drives only part of one averaged webhook. Empty when the workspace is not live
 *  in inference-all. Pure — the renderer only escapes and prints these. */
export function productionTags(
  name: string,
  prod: ProductionSignal | null,
  leaderId: string | null,
): ProductionTag[] {
  if (!prod) return [];
  const tags: ProductionTag[] = [];
  const partners = prod.members.filter((m) => m !== name);
  const blended = prod.members.length > 1;
  const signal = prod.signalName ?? 'one blended signal';

  if (blended) {
    tags.push({
      cls: 'mix',
      text: `\u26D9 blended into ${signal}`,
      title:
        `inference-all blends this workspace with ${partners.join(', ')} into ONE webhook ` +
        `(${signal}): inference.py averages the raw signals, so this workspace drives only part ` +
        `of the live position, and each leg is pinned separately.`,
    });
  }
  if (!prod.pin) return tags;

  const deployed = !!leaderId && prod.pin.toLowerCase() === leaderId.toLowerCase();
  tags.push(
    deployed
      ? {
          cls: 'winner',
          text: blended ? `\u2713 deployed \u2014 ${signal} leg` : '\u2713 deployed',
          title:
            `inference-all pins this workspace to this exact algo \u2014 the leader shown here is ` +
            `what trades live${blended ? ` as the ${name} leg of ${signal}` : ''}.`,
        }
      : {
          cls: 'prev',
          text: `\u26A0 not deployed \u2014 prod pins ${prod.pin}`,
          title:
            `inference-all pins ${blended ? `the ${name} leg of ${signal}` : 'production'} to ` +
            `${prod.pin}, NOT this leader. The leader is the R&D champion; production ` +
            `deliberately trades the pinned algo.`,
        },
  );
  return tags;
}
