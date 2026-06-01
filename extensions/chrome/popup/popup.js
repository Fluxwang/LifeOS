// Mock chrome shim — only active outside a real extension environment
(function(){
  var real = (typeof chrome!=='undefined' && chrome.runtime && chrome.runtime.id);
  if(real) return;
  var KEY='blockade.rules';
  function load(){try{return JSON.parse(localStorage.getItem(KEY))}catch(e){return null}}
  function seed(){var r=[
    {id:1,pattern:'*.youtube.com',displayName:'youtube.com（含所有子域）',addedAt:1748563200},
    {id:2,pattern:'www.reddit.com',displayName:'www.reddit.com',addedAt:1748390400},
    {id:3,pattern:'*.twitter.com',displayName:'twitter.com（含所有子域）',addedAt:1748476800}
  ];localStorage.setItem(KEY,JSON.stringify(r));return r;}
  var rules=load()||seed();
  function save(){localStorage.setItem(KEY,JSON.stringify(rules));}
  function host(u){try{return new URL(u).hostname}catch(e){return ''}}
  function match(rl,h){if(rl.pattern.indexOf('*.')===0){var b=rl.pattern.slice(2);return h===b||h.slice(-(b.length+1))==='.'+b;}return h===rl.pattern;}
  window.chrome={
    runtime:{
      sendMessage:function(msg,cb){
        var res;
        if(msg.action==='checkUrl'){var h=host(msg.url),hit=rules.filter(function(r){return match(r,h)})[0];res={ok:true,blocked:!!hit,ruleId:hit?hit.id:null};}
        else if(msg.action==='getPopupState'){var h2=host(msg.url),hit2=rules.filter(function(r){return match(r,h2)})[0];res={ok:true,blocked:!!hit2,ruleId:hit2?hit2.id:null,ruleCount:rules.length};}
        else if(msg.action==='addRule'){var id=rules.reduce(function(m,r){return Math.max(m,r.id)},0)+1;rules.push({id:id,pattern:msg.pattern,displayName:msg.displayName,addedAt:Math.floor(Date.now()/1000)});save();res={ok:true,id:id};}
        else if(msg.action==='removeRule'){rules=rules.filter(function(r){return r.id!==msg.id});save();res={ok:true};}
        else if(msg.action==='getRules'){res={ok:true,rules:rules.slice()};}
        setTimeout(function(){cb&&cb(res)},70);
      },
      openOptionsPage:function(){window.open('../options/options.html','_blank')}
    },
    tabs:{query:function(q,cb){cb([{url:window.__mockUrl||'https://www.youtube.com/watch?v=dQw4',id:1}])}}
  };
})();

// Popup logic
(function(){
  var IN_EXT = (typeof chrome!=='undefined' && chrome.runtime && chrome.runtime.id);
  var $=function(s){return document.getElementById(s)};
  var state={url:'',host:'',base:'',ruleId:null,blocked:false,supported:true,ready:false,checking:true};

  function baseDomain(h){var p=h.split('.');return p.length<=2?h:p.slice(-2).join('.');}

  function send(msg){return new Promise(function(res){chrome.runtime.sendMessage(msg,function(r){
    var err=chrome.runtime.lastError;
    if(err){res({ok:false,error:err.message||String(err)});return;}
    res(r||{});
  })});}

  function renderStatus(){
    var st=$('status'),txt=$('status-text'),btn=$('primary-btn');
    st.classList.remove('is-blocked','is-allowed');
    if(!state.ready){
      $('cannot').hidden=true;
      st.hidden=false; btn.disabled=true; btn.textContent='读取中'; btn.className='btn btn-primary';
      txt.textContent='读取中 · LOADING';
      return;
    }
    if(!state.supported){
      $('cannot').hidden=false;
      st.hidden=true; btn.disabled=true; btn.textContent='屏蔽此网站';
      return;
    }
    $('cannot').hidden=true; st.hidden=false; btn.disabled=false;
    if(state.checking){
      txt.textContent='检查中 · CHECKING';
      btn.disabled=true; btn.textContent='读取中'; btn.className='btn btn-primary'; btn.dataset.act='block';
      return;
    }
    if(state.blocked){
      st.classList.add('is-blocked'); txt.textContent='已屏蔽 · BLOCKED';
      btn.textContent='解除屏蔽'; btn.className='btn btn-danger'; btn.dataset.act='unblock';
    }else{
      st.classList.add('is-allowed'); txt.textContent='未屏蔽 · ALLOWED';
      btn.textContent='屏蔽此网站'; btn.className='btn btn-primary'; btn.dataset.act='block';
    }
  }

  function showView(v){
    $('view-main').hidden = v!=='main';
    $('view-confirm').hidden = v!=='confirm';
  }

  function setMainError(t){
    $('main-err').textContent=t||'';
    $('main-err').hidden=!t;
  }

  function toast(t){
    if(IN_EXT)return;
    var el=$('toast');el.textContent=t;el.classList.add('show');
    setTimeout(function(){el.classList.remove('show')},1400);
  }
  function done(t){
    if(IN_EXT){window.close();return;}
    toast(t);
    refresh();
  }

  function refresh(){
    state.checking=true;
    renderStatus();
    send({action:'getPopupState',url:state.url}).then(function(r){
      state.checking=false;
      if(r&&r.ok){
        state.blocked=!!r.blocked;
        state.ruleId=r.ruleId;
        $('count').textContent=String(r.ruleCount||0);
      }else{
        setMainError('读取状态失败 · '+((r&&r.error)||'runtime error'));
      }
      renderStatus();
    });
  }

  function init(){
    chrome.tabs.query({active:true,currentWindow:true},function(tabs){
      var tab=(tabs&&tabs[0])||{};
      state.url=tab.url||'';
      var ok=/^https?:\/\//i.test(state.url);
      state.supported=ok;
      state.ready=true;
      if(ok){
        state.host=new URL(state.url).hostname;
        state.base=baseDomain(state.host);
        $('domain').textContent=state.host;
        $('fav').textContent=(state.base[0]||'?');
        $('root-dom').textContent=state.base;
        $('exact-dom').textContent=state.host;
      }else{
        $('domain').textContent=state.url.split('/')[0]||'chrome://';
        $('fav').textContent='—';
      }
      renderStatus(); refresh();
    });
  }

  $('primary-btn').addEventListener('click',function(){
    if($('primary-btn').dataset.act==='unblock'){
      var btn=$('primary-btn');
      btn.disabled=true;
      setMainError('');
      send({action:'removeRule',id:state.ruleId}).then(function(r){
        if(r&&r.ok){
          done('已解除屏蔽 · UNBLOCKED');
        }else{
          setMainError('解除屏蔽失败 · '+((r&&r.error)||'DNR error'));
          btn.disabled=false;
        }
      });
    }else{
      setMainError('');$('err').hidden=true; showView('confirm');
    }
  });
  $('cancel').addEventListener('click',function(){showView('main');});
  $('confirm').addEventListener('click',function(){
    var scope=document.querySelector('input[name=scope]:checked').value;
    var pattern,display;
    if(scope==='root'){pattern='*.'+state.base;display=state.base+'（含所有子域）';}
    else{pattern=state.host;display=state.host;}
    send({action:'addRule',pattern:pattern,displayName:display}).then(function(r){
      if(r&&r.ok){showView('main');done('已加入屏蔽 · BLOCKED');}
      else{$('err').textContent='写入规则失败 · '+((r&&r.error)||'DNR error');$('err').hidden=false;}
    });
  });
  $('manage').addEventListener('click',function(){
    if(IN_EXT&&chrome.runtime.openOptionsPage){chrome.runtime.openOptionsPage();}
    else{chrome.runtime.openOptionsPage&&chrome.runtime.openOptionsPage();}
  });

  init();
})();
