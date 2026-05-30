// Mock chrome shim — only active outside a real extension environment
(function(){
  var real=(typeof chrome!=='undefined'&&chrome.runtime&&chrome.runtime.id);
  if(real)return;
  var KEY='blockade.rules';
  function load(){try{return JSON.parse(localStorage.getItem(KEY))}catch(e){return null}}
  function seed(){var r=[
    {id:1,pattern:'*.youtube.com',displayName:'youtube.com（含所有子域）',addedAt:1748563200},
    {id:2,pattern:'www.reddit.com',displayName:'www.reddit.com',addedAt:1748390400},
    {id:3,pattern:'*.twitter.com',displayName:'twitter.com（含所有子域）',addedAt:1748476800}
  ];localStorage.setItem(KEY,JSON.stringify(r));return r;}
  var rules=load()||seed();
  function save(){localStorage.setItem(KEY,JSON.stringify(rules))}
  window.chrome={runtime:{sendMessage:function(msg,cb){
    var res;
    if(msg.action==='getRules'){res={ok:true,rules:rules.slice()};}
    else if(msg.action==='removeRule'){rules=rules.filter(function(r){return r.id!==msg.id});save();res={ok:true};}
    setTimeout(function(){cb&&cb(res)},60);
  }}};
})();

// Options logic
(function(){
  var $=function(s){return document.getElementById(s)};
  var all=[];

  function send(msg){return new Promise(function(res){chrome.runtime.sendMessage(msg,function(r){
    var err=chrome.runtime.lastError;
    if(err){res({ok:false,error:err.message||String(err)});return;}
    res(r||{});
  })});}
  function setError(t){$('error').textContent=t||'';$('error').hidden=!t;}
  function isRoot(p){return p.indexOf('*.')===0;}
  function fav(r){var d=isRoot(r.pattern)?r.pattern.slice(2):r.pattern;return (d.replace(/^www\./,'')[0]||'?');}
  function when(ts){
    var d=new Date(ts*1000),now=Date.now()/1000,diff=now-ts;
    if(diff<86400)return '今天';
    if(diff<172800)return '昨天';
    var mm=('0'+(d.getMonth()+1)).slice(-2),dd=('0'+d.getDate()).slice(-2);
    return d.getFullYear()+'-'+mm+'-'+dd;
  }

  function row(r){
    var item=document.createElement('div');item.className='item';

    var f=document.createElement('div');f.className='fav';f.textContent=fav(r);
    var meta=document.createElement('div');meta.className='meta';
    var dn=document.createElement('div');dn.className='dname';dn.textContent=r.displayName;
    var pt=document.createElement('div');pt.className='pat';pt.textContent='urlFilter  ||'+(isRoot(r.pattern)?r.pattern.slice(2):r.pattern)+'^';
    meta.appendChild(dn);meta.appendChild(pt);

    var sc=document.createElement('div');
    sc.className='scope '+(isRoot(r.pattern)?'root':'exact');
    sc.textContent=isRoot(r.pattern)?'ROOT':'EXACT';

    var ad=document.createElement('div');ad.className='added';ad.textContent=when(r.addedAt);

    var del=document.createElement('button');del.className='del';del.title='删除 · remove';
    del.innerHTML='<svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M10 7V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2m-7 0 1 12a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1l1-12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    del.addEventListener('click',function(){
      del.disabled=true;
      setError('');
      send({action:'removeRule',id:r.id}).then(function(result){
        if(result&&result.ok){
          item.style.transition='opacity .15s,transform .15s';
          item.style.opacity='0';
          item.style.transform='translateX(8px)';
          setTimeout(loadRules,150);
        }else{
          del.disabled=false;
          setError('删除失败 · '+((result&&result.error)||'DNR error'));
        }
      });
    });

    item.appendChild(f);item.appendChild(meta);item.appendChild(sc);item.appendChild(ad);item.appendChild(del);
    return item;
  }

  function render(filter){
    var list=$('list');list.innerHTML='';
    var q=(filter||'').trim().toLowerCase();
    var rows=all.filter(function(r){return !q||r.displayName.toLowerCase().indexOf(q)>=0||r.pattern.toLowerCase().indexOf(q)>=0;});
    rows.sort(function(a,b){return b.addedAt-a.addedAt;});
    if(all.length===0){$('empty').hidden=false;list.hidden=true;}
    else{$('empty').hidden=true;list.hidden=false;rows.forEach(function(r){list.appendChild(row(r));});}
    $('stat-count').textContent=all.length;
  }

  function loadRules(){
    send({action:'getRules'}).then(function(r){
      if(r&&r.ok){
        setError('');
        all=r.rules||[];
        render($('search').value);
      }else{
        all=[];
        render($('search').value);
        setError('读取屏蔽列表失败 · '+((r&&r.error)||'storage error'));
      }
    });
  }

  $('search').addEventListener('input',function(e){render(e.target.value);});
  loadRules();
})();
