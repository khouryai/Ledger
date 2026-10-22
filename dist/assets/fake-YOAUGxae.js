import{a7 as l,ay as m,az as y,aA as h,aB as u}from"./index-DVpG7G7s.js";class f{constructor(s={}){this.opts=s}opts;model="fake";calls=[];async complete(s){this.calls.push(s);const t=/---\n([\s\S]*?)\n---/.exec(s.user)?.[1]??s.user,o=this.opts.today??l(new Date),a={workDays:[1,2,3,4,5],holidays:[]};if(s.schema===m){const e=this.opts.myName||"the reader",i=s.system.includes(`This text was written by ${e}`),r=i?/written by .*? to ([^.\n]+)\./.exec(s.system)?.[1]:/written by (.+?) to /.exec(s.system)?.[1];return y(t,{today:o,cal:a,order:"MDY",people:[],myName:this.opts.myName??""},i,r)}if(s.schema===h){const e=u(t,o,a,"MDY");return JSON.stringify({verdict:e.verdict,when:e.promisePhrase??"",summary:e.summary})}const n=/To: (\S+)/.exec(s.user)?.[1]??"there",c=s.user.split(`
`).filter(e=>e.startsWith("- ")).map(e=>e.slice(2).replace(/ \(.*$/,""));return/weekly status/.test(s.system)?`This week in brief: ${s.user.split(`
`).slice(0,3).join(" ")}`:/before a call/.test(s.system)?`Before the call: ${s.user.split(`
`).slice(0,2).join(" ")}`:`Hi ${n},

Checking in on ${c.join(" and ")}. Could you let me know where it stands?

Thanks,
${this.opts.myName??""}`}}export{f as FakeEngine};
