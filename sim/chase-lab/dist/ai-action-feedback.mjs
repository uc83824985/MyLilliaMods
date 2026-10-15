// Engine-independent action feedback ledger; host publishes only confirmed transitions.
export function actionLedger(host,actor){
  host.actionFeedback??={};
  return host.actionFeedback[actor]??=new ActionFeedback(actor);
}
export class ActionFeedback {
  constructor(actor){this.actor=actor;this.sequence=0;this.eventSequence=0;this.current=null;this.events=[];}
  request(kind){return {requestId:`${this.actor}:${++this.sequence}`,kind};}
  publish(request,status,phase=null,reason=null){
    if(!['accepted','rejected','running','succeeded','failed','interrupted'].includes(status))throw Error('Invalid action status');
    const event={...request,status,phase,reason,sequence:++this.eventSequence};
    if(status==='accepted'||status==='running')this.current=event;
    else if(this.current?.requestId===request.requestId)this.current=null;
    this.events.push(event);if(this.events.length>32)this.events.shift();return event;
  }
  snapshot(){return {current:this.current?{...this.current}:null,events:this.events.map(e=>({...e}))};}
}
