import {useEffect, useRef, useState, type RefObject} from 'react';
import type {Terminal, IMarker} from '@xterm/xterm';
import type {TerminalLogState} from './types';
import {errorLine} from './terminal-navigation';
export default function TerminalSessionTools({terminal,id,generation}:{terminal:RefObject<Terminal|null>;id:string;generation:number}) {
  const [log,setLog]=useState<TerminalLogState>({id,active:false,path:'',bytes:0,error:''});
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const [marks,setMarks]=useState<IMarker[]>([]);
  useEffect(()=>{
    let alive=true;
    const apply=(value:TerminalLogState)=>{if(alive && value.id===id)setLog(value);};
    const off=window.hrig.onTerminalLog(apply);
    void window.hrig.terminalLog({id,op:'status'}).then(apply).catch(e=>{if(alive)setNotice(e.message);});
    return ()=>{alive=false;off();};
  },[id,generation]);
  const ownedMarks=useRef<IMarker[]>([]);
  useEffect(()=>{setMarks([]);return ()=>{ownedMarks.current.forEach(m=>m.dispose());ownedMarks.current=[];};},[generation]);
  async function toggle(){setBusy(true);setNotice('');try{setLog(await window.hrig.terminalLog({id,op:log.active?'stop':'start'}));}catch(e){setNotice((e as Error).message);}finally{setBusy(false);}}
  function mark(){
    const term=terminal.current;if(!term)return;
    if(term.buffer.active.type!=='normal'){setNotice('Marks are available in the normal terminal buffer.');return;}
    if(marks.length>=100){setNotice('Limit of 100 marks reached. Clear marks first.');return;}
    const b=term.buffer.active, marker=term.registerMarker(b.viewportY-(b.baseY+b.cursorY));
    if(marker){ownedMarks.current.push(marker);marker.onDispose(()=>setMarks(old=>old.filter(m=>m!==marker)));setMarks(old=>[...old,marker]);}
  }
  function jump(line:number){terminal.current?.scrollToLine(line);terminal.current?.focus();}
  function error(direction:-1|1){const term=terminal.current;if(!term)return;const found=errorLine(term.buffer.active,term.buffer.active.viewportY,direction);if(found===null)setNotice('No more error-like lines in retained output.');else{setNotice('');jump(found);}}
  return <div className="terminal-tools-actions" aria-label="Terminal recording and navigation">
    <button disabled={busy} onClick={()=>void toggle()} title={log.path || 'Choose a local file; appends output from now on'}>{log.active?'● Logging · Stop':'Start log…'}</button>
    <button onClick={mark}>Mark view</button>
    <select aria-label="Jump to terminal mark" value="" onChange={e=>{const m=marks.find(m=>m.id===Number(e.target.value));if(m&&!m.isDisposed)jump(m.line);}}><option value="">Marks ({marks.length})</option>{marks.map((m,i)=><option key={m.id} value={m.id}>Mark {i+1} · line {m.line+1}</option>)}</select>
    <button onClick={()=>{marks.forEach(m=>m.dispose());setMarks([]);}}>Clear marks</button>
    <button onClick={()=>error(-1)}>Previous error</button><button onClick={()=>error(1)}>Next error</button>
    {(log.error||notice)&&<span role="status" title={log.error||notice}>{log.error||notice}</span>}
  </div>;
}
