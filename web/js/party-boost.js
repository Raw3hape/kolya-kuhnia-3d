// Local optical presentation only. Accepted room time controls expiry; no gameplay
// speed/aim changes or replicated particles. Reduced motion keeps a static tint.
export function createPartyBoost({canvas,spec}){
 const effect=document.createElement('div');effect.className='party-energy-effect';effect.hidden=true;effect.setAttribute('aria-hidden','true');
 const label=document.createElement('div');label.className='party-boost-label';label.hidden=true;label.setAttribute('role','status');document.body.append(effect,label);
 const mq=matchMedia('(prefers-reduced-motion:reduce)');let last='',priorFilter=null;
 function clear(){effect.hidden=label.hidden=true;if(priorFilter!==null){canvas.style.filter=priorFilter;priorFilter=null;}last='';}
 function update(boost,time,active){
  if(!active||!boost||time>=boost.until){clear();return false;}
  const v=spec.energy.variants.find(v=>v.id===boost.variant);if(!v){clear();return false;}
  const remaining=Math.max(0,boost.until-time),fade=Math.min(1,remaining/2),power=Math.min(1,Math.max(.2,boost.strength))*fade;
  effect.hidden=label.hidden=false;effect.style.setProperty('--energy-tint',v.tint);effect.style.opacity=String(power*.60);effect.classList.toggle('energy-still',mq.matches);
  if(priorFilter===null)priorFilter=canvas.style.filter;
  canvas.style.filter=`${priorFilter} saturate(${1+power*.46}) contrast(${1+power*.07})`.trim();
  const text=v.effect+' · '+Math.ceil(remaining)+' с';if(text!==last){label.textContent=text;last=text;}label.style.borderColor=v.tint;
  return true;
 }
 return{update,clear,dispose(){clear();effect.remove();label.remove();}};
}
