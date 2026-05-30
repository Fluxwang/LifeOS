(function(){
  var IN_EXT=(typeof chrome!=='undefined'&&chrome.runtime&&chrome.runtime.id);
  var $=function(s){return document.getElementById(s)};

  // Read blocked URL from query — textContent only, no innerHTML (XSS safe)
  function readBlockedHost(){
    try{
      var p=new URLSearchParams(location.search).get('url');
      if(!p)return 'www.youtube.com';
      return new URL(p).hostname;
    }catch(e){return 'www.youtube.com';}
  }
  $('domain').textContent=readBlockedHost();

  // Witty focus lines: [headline, subline]
  var LINES=[
    ['这个站，被你关进小黑屋了','Nothing to see here. 回去把那件正事做完吧。'],
    ['未来的你，刚刚谢过现在的你','Past-you blocked this for a reason. Trust them.'],
    ['深呼吸，这点时间够你写完那个函数','Close the tab. Open the editor. Ship it.'],
    ['它还在，只是你今天不需要它','It will survive without you. 你也会。'],
    ['专注，是你给自己最好的外挂','No cheat codes here — just focus.'],
    ['想刷一下？这就是你屏蔽它的原因','The urge is the bug. This page is the patch.']
  ];
  function roll(){
    var i=Math.floor(Math.random()*LINES.length);
    $('headline').textContent=LINES[i][0];
    $('subline').textContent=LINES[i][1];
  }
  roll();
  $('reroll').addEventListener('click',roll);

  $('manage').addEventListener('click',function(){
    if(IN_EXT&&chrome.runtime.openOptionsPage){chrome.runtime.openOptionsPage();}
    else{window.open('../options/options.html','_blank');}
  });
})();
