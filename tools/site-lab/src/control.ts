import type { IncomingMessage, ServerResponse } from "node:http";
import { effectiveHealth, isHealth, type SimServer, type SiteLabEvent } from "./model";

/**
 * Control panel (http://127.0.0.1:8600): shows each simulated BMC, when the
 * collector last polled it, and lets you fail / degrade / repair a component.
 * A change is applied to the model (the next Redfish poll sees it) and the
 * matching vendor trap is sent immediately (via `onChange`).
 */

export interface ControlDeps {
  servers: SimServer[];
  events: SiteLabEvent[];
  onChange: (server: SimServer, componentId: string) => Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 10_000) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export function controlHandler(deps: ControlDeps) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const url = (req.url ?? "/").split("?")[0];

    if (req.method === "GET" && url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(PAGE);
      return;
    }
    if (req.method === "GET" && url === "/api/state") {
      json(200, {
        servers: deps.servers.map((s) => ({
          ...s,
          components: s.components.map((c) => ({ ...c, effective: effectiveHealth(c) })),
        })),
        events: deps.events.slice(-40).reverse(),
      });
      return;
    }
    const m = url.match(/^\/api\/servers\/([\w-]+)\/components\/([\w-]+)$/);
    if (req.method === "POST" && m) {
      const server = deps.servers.find((s) => s.id === m[1]);
      const component = server?.components.find((c) => c.id === m[2]);
      if (!server || !component) {
        json(404, { error: "unknown server or component" });
        return;
      }
      let body: { health?: unknown; predictive?: unknown };
      try {
        body = JSON.parse((await readBody(req)) || "{}");
      } catch {
        json(400, { error: "invalid JSON" });
        return;
      }
      if (body.health !== undefined && !isHealth(body.health)) {
        json(400, { error: "health must be OK, Warning or Critical" });
        return;
      }
      if (body.predictive !== undefined && typeof body.predictive !== "boolean") {
        json(400, { error: "predictive must be a boolean" });
        return;
      }
      if (body.predictive && component.kind !== "drive") {
        json(400, { error: "only drives report predictive failure" });
        return;
      }
      if (isHealth(body.health)) {
        component.health = body.health;
      }
      if (typeof body.predictive === "boolean") {
        component.predictive = body.predictive;
      }
      await deps.onChange(server, component.id);
      json(200, { ...component, effective: effectiveHealth(component) });
      return;
    }
    json(404, { error: "not found" });
  };
}

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OpsDesk Site Lab</title>
<style>
:root{--bg:#f8fafc;--card:#fff;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--ok:#15803d;--warn:#b45309;--crit:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#0b1120;--card:#111827;--ink:#e5e7eb;--muted:#94a3b8;--line:#1f2937;--ok:#4ade80;--warn:#fbbf24;--crit:#f87171}}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,Segoe UI,sans-serif;background:var(--bg);color:var(--ink)}
main{max-width:1100px;margin:0 auto;padding:20px 16px}h1{font-size:20px;margin:0 0 4px}p.sub{color:var(--muted);margin:0 0 16px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px}
.card h2{font-size:15px;margin:0}.meta{color:var(--muted);font-size:12px;margin:2px 0 10px}
table{width:100%;border-collapse:collapse}td{padding:6px 4px;border-top:1px solid var(--line);vertical-align:middle}
.h{font-weight:600;font-size:12px}.OK{color:var(--ok)}.Warning{color:var(--warn)}.Critical{color:var(--crit)}
button{font:inherit;font-size:12px;padding:3px 7px;border:1px solid var(--line);border-radius:6px;background:transparent;color:var(--ink);cursor:pointer;margin:1px}
button:hover{border-color:var(--muted)}button.crit{color:var(--crit)}
.note{font-size:12px;color:var(--warn);margin:10px 0 0}
ul{list-style:none;padding:0;margin:0;font-size:12px;font-family:ui-monospace,Consolas,monospace}li{padding:3px 0;border-top:1px solid var(--line)}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:var(--muted)}.dot.live{background:var(--ok)}
</style></head><body><main>
<h1>OpsDesk Site Lab</h1>
<p class="sub">Simulated iDRAC and iLO. The real site collector polls their Redfish APIs and receives their SNMP traps. Change a part below and watch it reach OpsDesk.</p>
<div class="grid" id="servers"></div>
<p class="note">Critical faults open a P1 incident and page the NOC roster (in-app and email) under the default alert rule.</p>
<div class="card" style="margin-top:16px"><h2>Activity</h2><ul id="events"></ul></div>
</main><script>
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
async function act(sid,cid,body){
  if(body.health==="Critical"&&!confirm("Critical opens a P1 incident and emails the NOC roster. Continue?"))return;
  const r=await fetch("/api/servers/"+sid+"/components/"+cid,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  if(!r.ok)alert((await r.json()).error);load();
}
function ago(t){if(!t)return "never";const s=Math.round((Date.now()-Date.parse(t))/1000);return s<60?s+"s ago":Math.round(s/60)+"m ago"}
async function load(){
  try{
  const st=await (await fetch("/api/state")).json();
  document.getElementById("servers").innerHTML=st.servers.map(s=>{
    const live=s.lastPolledAt&&Date.now()-Date.parse(s.lastPolledAt)<120000;
    return '<div class="card"><h2>'+(s.vendor==="DELL"?"Dell iDRAC":"HPE iLO")+' · '+esc(s.ciCode)+'</h2>'+
    '<div class="meta"><span class="dot '+(live?"live":"")+'"></span>Redfish https://127.0.0.1:'+s.port+' · traps from '+s.trapSource+' · last polled '+ago(s.lastPolledAt)+'</div><table>'+
    s.components.map(c=>'<tr><td>'+esc(c.name)+'</td><td class="h '+c.effective+'">'+c.effective+(c.predictive?" (predicted)":"")+'</td><td style="text-align:right">'+
      '<button onclick="act(\\''+s.id+'\\',\\''+c.id+'\\',{health:\\'OK\\',predictive:false})">Repair</button>'+
      (c.kind==="drive"?'<button onclick="act(\\''+s.id+'\\',\\''+c.id+'\\',{predictive:true})">Predict fail</button>':'')+
      '<button onclick="act(\\''+s.id+'\\',\\''+c.id+'\\',{health:\\'Warning\\'})">Degrade</button>'+
      '<button class="crit" onclick="act(\\''+s.id+'\\',\\''+c.id+'\\',{health:\\'Critical\\'})">Fail</button></td></tr>').join("")+
    '</table></div>'}).join("");
  document.getElementById("events").innerHTML=st.events.map(e=>'<li>'+esc(e.at.slice(11,19))+' '+esc(e.server)+' · '+esc(e.message)+'</li>').join("")||"<li>No activity yet</li>";
  }catch(e){document.getElementById("events").innerHTML="<li>Site lab not reachable</li>"}
}
load();setInterval(load,2000);
</script></body></html>`;
