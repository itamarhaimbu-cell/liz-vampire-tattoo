/* Draft A+D — the ink bleed shader (used by ink.js).
   The front of the spread is a real ink stain: an opaque black core with rounded, fractal lobes and small capillary
   fingers, a feathered fringe that soaks ahead into the old film, and a faint meniscus sheen. Behind the front the
   new film develops up out of the ink, like a print in the tray. At p = 1 the result is exactly the DOM layer
   (same cover-fit and object-position, the films' baked grey, shade and vignette), so the hand-over is invisible.
   A+D adds, per transition: uEdge — a soft, even bone highlight riding the leading edge (wet ink catching the light),
   so the bleed reads even over a dark film; uGlow (pale light in the fringe fibres) is kept for tuning but set to 0:
   lit fibres read as electricity, not ink. */
window.INK_SHADER = {
  VERT: 'attribute vec2 p;varying vec2 vUv;void main(){vUv=p*.5+.5;gl_Position=vec4(p,0.,1.);}',
  FRAG: [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH', 'precision highp float;', '#else', 'precision mediump float;', '#endif',
    'varying vec2 vUv;',
    'uniform sampler2D uTex;uniform vec2 uTexSize;uniform vec2 uRes;uniform float uP;uniform vec2 uOrigin;',
    'uniform float uSeed;uniform float uScale;uniform vec3 uShade;uniform float uMaxD;uniform float uTime;',
    'uniform float uEdge;uniform float uGlow;uniform vec2 uPos;',
    'float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}',
    'float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);',
    ' return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x),u.y);}',
    'float fbm(vec2 p){float v=0.,a=.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);',
    ' for(int i=0;i<5;i++){v+=a*noise(p);p=m*p;a*=.5;}return v;}',
    'float fbm3(vec2 p){float v=0.,a=.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);',
    ' for(int i=0;i<3;i++){v+=a*noise(p);p=m*p;a*=.5;}return v*1.143;}',
    'void main(){',
    ' vec2 uv=vUv;float asp=uRes.x/uRes.y;',
    ' vec2 st=uv*vec2(asp,1.);',
    ' float d=length((uv-uOrigin)*vec2(asp,1.))/uMaxD;',
    ' float tt=uTime*.01;',
    // two levels of domain warp: big rounded lobes carrying smaller ones
    ' vec2 w1=vec2(fbm(st*1.3+uSeed+tt),fbm(st*1.3+uSeed+3.1-tt));',
    ' vec2 w2=vec2(fbm(st*3.1+w1*1.9+uSeed*.7),fbm(st*3.1+w1*1.9+uSeed*.7+5.2));',
    ' float n=fbm(st*1.9+w2*2.3);',
    ' float field=d*.86+(n-.5)*.62;',
    // capillary fingers along the edge
    ' float fing=fbm(st*8.5+w2*1.6+uSeed*2.);',
    ' float fm=field-(fing-.5)*.1;',
    ' float front=mix(-.34,1.16,uP);',
    ' float aa=2.2/uRes.y;',
    // the opaque core of the stain
    ' float core=1.-smoothstep(front-aa,front+aa,fm);',
    // feathered fringe: ink wicking into the fibres just ahead of the core
    ' float fib=fbm3(st*58.+w1*4.+uSeed*4.);',
    ' float reach=.022+fib*.05;',
    ' float fringe=(1.-smoothstep(front,front+reach,fm))*(1.-core)*.78;',
    // a wide, faint soak ahead of everything
    ' float ahead=max(fm-front,0.);',
    ' float soak=exp(-ahead/.07)*(1.-core)*(1.-fringe)*.34;',
    ' float live=smoothstep(0.,.04,uP)*(1.-smoothstep(.9,1.,uP));',
    ' fringe*=live;soak*=live;',
    // the leading edge catches the light: a thin bone line, broken up by the same fibres
    // it follows the stain's big lobes (field), not every capillary finger (fm), so it reads as one smooth wet line
    ' float rim=exp(-abs(field-front-.012)/.0075)*live*uEdge*(.88+.16*fib)*.34;',
    // develop: the new film rises out of the ink a little behind the front
    ' float dev=smoothstep(.07,.36,front-fm);dev=dev*dev*(3.-2.*dev);',
    // meniscus: a whisper of light right at the inside of the edge
    ' float sheen=exp(-max(front-fm,0.)/.005)*core*.05*live;',
    // the incoming film: screen-space push-in, then cover-fit with object-position (as the DOM layer does)
    ' vec2 u2=(uv-.5)/uScale+.5;float yTop=1.-u2.y;',
    ' float ta=uTexSize.x/uTexSize.y;vec2 tc;',
    ' if(asp>ta){float f=ta/asp;tc=vec2(u2.x,(1.-f)*uPos.y+yTop*f);}',
    ' else{float f=asp/ta;tc=vec2((1.-f)*uPos.x+u2.x*f,yTop);}',
    ' vec3 c=texture2D(uTex,tc).rgb;',
    // the films arrive grey with their contrast baked in (assets/video/bw), exactly what the DOM layer shows unfiltered
    ' float l=dot(c,vec3(.2126,.7152,.0722));',
    ' vec3 col=vec3(l);',
    ' float yc=1.-uv.y;',
    ' float sa=yc<.5?mix(uShade.x,uShade.y,yc/.5):mix(uShade.y,uShade.z,(yc-.5)/.5);',
    ' col=mix(col,vec3(6./255.),sa);',
    ' float r=length((uv-.5)/.5)/1.41421356;',
    ' col=mix(col,vec3(0.),clamp((r-.4)/.6,0.,1.)*.72);',
    ' col=mix(vec3(6./255.),col,dev)+vec3(.925,.906,.867)*sheen;',
    // the fringe fibres: ink-black, lifted toward pale bone by uGlow where the fibre is dense
    ' vec3 fcol=mix(vec3(4./255.),vec3(.925,.906,.867)*.26,clamp(uGlow*fib,0.,1.));',
    // premultiplied: film inside the core, fibres in the fringe, ink in the soak, light on the edge
    ' float a=min(1.,core+fringe+soak+rim);',
    ' gl_FragColor=vec4(col*core+fcol*fringe+vec3(4./255.)*soak+vec3(.925,.906,.867)*rim,a);',
    '}'
  ].join('\n')
};
