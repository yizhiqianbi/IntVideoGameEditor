/* Older Safari (<16) has no AbortSignal.timeout and (<17.4) no AbortSignal.any;
   app, collector and pixel code call both. Load-first, guarded, spec-shaped. */
(()=>{const A=typeof AbortSignal==='function'?AbortSignal:null;if(!A||typeof AbortController!=='function')return;
 const reason=(name,msg)=>{try{return new DOMException(msg,name);}catch{const e=new Error(msg);e.name=name;return e;}};
 if(typeof A.timeout!=='function')A.timeout=ms=>{const c=new AbortController();setTimeout(()=>c.abort(reason('TimeoutError','signal timed out')),ms);return c.signal;};
 if(typeof A.any!=='function')A.any=signals=>{const c=new AbortController();for(const s of signals){if(s.aborted){c.abort(s.reason);return c.signal;}}
  for(const s of signals)s.addEventListener('abort',()=>{if(!c.signal.aborted)c.abort(s.reason);},{once:true});return c.signal;};
})();
/* First-party optional measurement. No SDK or content capture. */
(()=>{'use strict';
 if(window.__nyMeasurement)return;
 const KEY='ny.measurement.v2',DAY=86400000,uuid=()=>crypto.randomUUID(),validId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(v);
 let bootSeen=false,bootWatched=false,bootEarly=null; // boot watchdog (declared before any event() can run)
 // Registered first, so an early exit is queued BEFORE the collector's own hide/pagehide flush sends.
 document.addEventListener('visibilitychange',()=>{try{bootEarly?.(false);}catch{}});addEventListener('pagehide',()=>{try{bootEarly?.(true);}catch{}});
 // BEGIN GENERATED EVENT CONTRACT
 // Generated from measurement-event.schema.json; do not edit.
 const names=new Set(["experience.boot_timeout","acquisition.landing_observed","funnel.stage_exposed","funnel.action_committed","auth.attempted","auth.client_resolved","auth.escape_offered","auth.escape_clicked","auth.escape_redeemed","commerce.paywall_exposed","commerce.plan_selected","commerce.checkout_returned","commerce.checkout_client_failed","commerce.checkout_mounted","conversation.submit","conversation.audio_started","conversation.caption_started","conversation.turn_completed","conversation.turn_failed","voice.requested","voice.playback_completed","voice.playback_failed","experience.app_ready","experience.avatar_ready","experience.client_error","experience.startup_started","experience.startup_resolved","experiment.client_exposed","engagement.interval","feature.entered","feature.exited","game.started","game.progressed","game.completed","game.abandoned","quota.upgrade_selected","experience.audio_output","voice.turn_summary","call.started","call.failed","call.ended"]);
 const features=new Set(["home","chat","call","photo","apps","settings","paywall","billing","scrapbook","letters","journal","stamps","lofiStudy","focusTimer","bedtimeStories","pongMini","twoTruths","triviaDuel","wyr","buildTogether","date","whatIf","song","riddleMe","wordChain","twentyQ","connectFour","reversi","checkers","chess","activity","memory","summary","unknown"]);
 const dimensions={"auth_mode":["popup","redirect","password","unknown"],"auth_browser":["desktop","mobile","standalone","in_app","unknown"],"geo_source":["cloudflare_signup","stripe_checkout"],"paywall_reason":["user_initiated","automatic_exhaustion","unknown"],"allowance_state":["available","exhausted","unknown"],"startup_scope":["account","avatar"],"startup_outcome":["completed","failed","superseded","abandoned"],"observation":["current_state"],"visibility":["visible","hidden"],"timing_status":["complete","overflow"],"phase":["started","auth_sdk_start","auth_sdk_ready","auth_verdict","token_start","token_ready","session_start","session_headers","session_ready","claims_ready","assets_start","assets_ready","decode_ready","first_frame"],"origin":["web","ios","unknown"],"stage":["landing","welcome","signup","upgrade","consent","beats","checking","saving","subscription","home","narration0","narration1","narration2","narration3","askAuth","askName","askBirthday","verify_wall","region_signup_block"],"outcome":["no_result","success","cancel","error","pending","timeout","muted","text_only","complete","active","inactive","cancellation_requested","ended"],"provider":["google","apple","x","email","unknown"],"plan":["monthly","annual","weekly","unknown"],"currency":["AED","AFN","ALL","AMD","ANG","AOA","ARS","AUD","AWG","AZN","BAM","BBD","BDT","BHD","BIF","BMD","BND","BOB","BRL","BSD","BWP","BYN","BZD","CAD","CDF","CHF","CLP","CNY","COP","CRC","CVE","CZK","DJF","DKK","DOP","DZD","EGP","ETB","EUR","FJD","FKP","GBP","GEL","GIP","GMD","GNF","GTQ","GYD","HKD","HNL","HTG","HUF","IDR","ILS","INR","ISK","JMD","JOD","JPY","KES","KGS","KHR","KMF","KRW","KWD","KYD","KZT","LAK","LBP","LKR","LRD","LSL","MAD","MDL","MGA","MKD","MMK","MNT","MOP","MUR","MVR","MWK","MXN","MYR","MZN","NAD","NGN","NIO","NOK","NPR","NZD","OMR","PAB","PEN","PGK","PHP","PKR","PLN","PYG","QAR","RON","RSD","RUB","RWF","SAR","SBD","SCR","SEK","SGD","SHP","SLE","SOS","SRD","STD","SZL","THB","TJS","TND","TOP","TRY","TTD","TWD","TZS","UAH","UGX","USD","UYU","UZS","VND","VUV","WST","XAF","XCD","XCG","XOF","XPF","YER","ZAR","ZMW"],"route":["mini","modal","cache","unknown"],"admission_result":["admitted","replay","busy","quota","rate_limited","denied","unavailable","cancelled","timeout"],"sync_action":["write","read","clear","day","changes","history","reconcile","unknown"],"sync_result":["success","rate_limited","denied","invalid_request","unavailable","cancelled"],"mode":["trial","paid","free","tester","permanent_premium","unknown"],"error":["network","timeout","permission","provider","invalid_response","cancel","unknown"],"failure_reason":["auth","quota","turn_conflict","too_large","rate_limited","server","bad_response","empty_reply","network","offline","context_suspended","output_stalled","lost_ended","audio_missing","gpu_lost","render_crash","webgl_missing","asset_http","load_failed","context_closed","start_failed","rejected","malformed_reply","unknown","region_blocked"],"source":["stripe","apple","testing","unknown"],"path":["landing","app"],"billing_reason":["subscription_create","subscription_cycle","subscription_update","unknown"],"component":["llm","tts","asr"],"cost_basis":["provider","allocated","reserved"],"engagement":["active","intentional"],"load_kind":["initial","swap","restore","retry"],"audio_phase":["context_created","context_closed","state_changed","resume_resolved","clock_probe","playback_terminal"],"audio_reason":["initial","gesture","foreground","frozen","recovered","source_setup","ended","watchdog","cancel","dispose","platform","external_or_unknown","unknown"],"audio_state":["running","suspended","interrupted","closed","unavailable"],"audio_previous_state":["running","suspended","interrupted","closed","unavailable"],"audio_resume_result":["not_needed","resolved","rejected","timeout"],"audio_error":["none","not_allowed","invalid_state","abort","other"],"audio_steady":["yes","no","unknown"],"audio_progress":["none","partial","complete","unknown"],"audio_session_type":["auto","playback","play-and-record","ambient","transient","transient-solo","unsupported","unknown"],"audio_activation":["active","inactive","unavailable"],"audio_record":["summary","prior","sample"],"rejection":["method","payload_too_large","invalid_body","retired_feature","game_unavailable","age_restricted","invalid_pilot_turn","invalid_request","unknown_kind","invalid_summary","invalid_memory","memory_budget","invalid_proactive","invalid_one_shot","photo_too_large","not_provisioned","cost_reservation","turn_completed","other","invalid_audio","audio_too_large","upload_timeout","asr_unconfigured","asr_admission","photo_rejected","authentication_rate_limited","rate_limited","inference_in_progress","daily_allowance_reached","pilot_retry_limit","inference_access_unavailable","invalid_inference_access","invalid_authentication","email_unverified","account_service_unavailable","voice_grant_consumed","invalid_voice_grant","invalid_lane","invalid_subject","invalid_audio_duration","invalid_chess_game","pilot_lease_expired","invalid_cost_reservation","admission_timeout","admission_unavailable"],"error_class":["type","reference","range","syntax","dom","network","security","abort","type_not_function","type_nullish","dom_not_found","dom_hierarchy","dom_invalid_state","dom_not_allowed","dom_quota","dom_timeout","other","none"],"error_origin":["app","vendor","extension","inline","unknown"],"audio_sample_rate":["16000","22050","24000","44100","48000","96000","other"],"request_kind":["chat","oneShot","summary","memory","gameFinish","activityFinish","asr","session","tts","other","none"],"network_detail":["timeout","abort","fetch_failed","other"],"audio_effects_state":["running","suspended","interrupted","closed","none"],"asr_provider":["groq","mini","workers-ai","none"],"asr_failure_stage":["provider_busy","provider_auth","provider_response","provider_timeout","provider_transport_or_decode"],"hedge":["primary","hedge","failed"],"asr_failed_provider":["groq","mini","workers-ai"],"call_stage":["setup","permission","capture","transcription"],"call_failure":["blocked","policy","permission_timeout","unavailable","network","allowance","account","service_configuration","service_busy"],"end_reason":["hangup","dropped","error","backgrounded","allowance","navigation"],"call_recovered":["yes","no","none"],"browser_engine":["blink","webkit","gecko","other"],"in_app":["none","tiktok","instagram","facebook","x","line","snapchat","other"],"net_type":["4g","3g","2g","slow_2g","unknown"],"voice_load":["grant_missing","no_account","access_changed","no_context","token_failed","fetch_failed","http_error","decode_failed","chunk_failed","aborted","token_initial_failed","token_refresh_failed","body_failed"],"token_forced":["yes","no"],"cancel_phase":["waiting","speaking","after_speech"],"memory_only":["yes"],"render_backend":["mini","modal","unknown"],"tts_phase":["auth","body","grant","admission","router"],"date_location":["cafe","park","cinema","arcade","bookshop","karaoke","rooftop","pool","beach"],"grant_miss":["none_stored","expired","who","v2_needed","text"],"page_translated":["yes","no"],"audio_effects_progress":["absent","advancing","stalled","not_observed"],"audio_cue_age":["never","lt_250ms","lt_2s","older"],"audio_route_transition":["none","to_record","from_record","multiple"],"audio_context_origin":["initial","gesture","foreground","frozen","recovered","unknown"],"audio_context_age":["lt_5s","lt_60s","lt_10m","older","unknown"],"auth_error":["back_navigation","no_result","missing_initial_state","web_storage_unsupported","network_request_failed","internal_error","popup_blocked","popup_closed","cancelled","provider_mismatch","timeout","user_disabled","account_exists","invalid_credential","too_many_requests","embedded_browser","external_browser_required","server","other","invalid_email","weak_password"],"error_value":["error","dom","event","string","object","undefined","other"],"ad_script":["yes","no"],"auth_os":["ios","android","desktop","other"],"in_app_host":["x","tiktok","instagram","facebook","other"],"boot_stage":["door","entry_waiting","bundle_import","app_init","hidden"],"locale":["en","zh-Hans","ja","es","fr"],"tz_bucket":["cn","hk","mo","tw","sg","my","jp","kr","ph","id","th","vn","in","other_asia","europe","us","other_americas","oceania","africa","other"],"abuse_reason":["device","network","disposable","alias","cn_vpn"],"net_sent":["yes","no"],"currency_choice":["auto","manual"],"allowance_scope":["account","device","network"],"payer":["paid","free"],"voice_error_kind":["abort","timeout","type","network","other"],"voice_output":["web_audio","media"],"admission_failure":["missing_binding","request_dispatch","response_body","response_parse","invalid_denial","invalid_receipt","coded_refusal","timeout","cancelled"],"avatar_wait_reason":["callback_unobserved","callback_not_pending","callback_host_closed","callback_host_hidden","callback_host_mismatch","canvas_detached","frame_throttled","model_missing","gpu_lost","projection_missing","draw_pending","render_exception","unknown"],"voice_media_terminal":["clock_stalled","ended_early","media_error","deadline","play_rejected","unknown"],"admission_code":["authentication_rate_limited","chess_limit_reached","chess_reaction_limited","daily_allowance_reached","date_used_today","disposable_email","email_unverified","inbox_in_use","inference_access_unavailable","inference_in_progress","invalid_authentication","invalid_chess_game","invalid_inference_access","invalid_pilot_turn","invalid_voice_grant","pilot_exhausted","pilot_lease_expired","pilot_retry_limit","pilot_turn_completed","rate_limited","region_unavailable","subscription_required","voice_grant_consumed","admission_timeout","admission_unavailable"],"media_stop":["no_progress","short_ended","media_error","backstop","play_rejected"],"admission_operation":["request_dispatch","response_body","response_parse","invalid_denial","invalid_receipt"],"asset_resource":["model_index","vault_key","model_pack"],"relay_failure":["transport","upstream_status","missing_body","size_limit"],"chat_phase":["token","headers","body","parse","retry_wait","reply_ready"],"chat_timing_status":["complete","overflow","origin_unknown"],"avatar_load_step":["manifest_parse","binary_view","texture_decode","shader_program"],"media_paused":["yes","no"],"voice_first_stage":["token_initial","token_refresh","headers","body","decode"],"voice_first_error":["abort","timeout","type","network","other"],"call_mic_error":["unsupported","not_found","not_readable","abort","invalid_state","other"],"call_capture_error":["context_create","track_ended","setup_timeout","worklet_setup","recorder_create","recorder_start","recorder_error","audio_frozen"],"asset_phase":["headers","body"],"error_source_shape":["event_filename","stack_http","stack_nonhttp","stack_relative","stack_no_url","no_stack"],"asset_error_kind":["deadline","stall","fetch_type","abort","http","other"],"asset_browser_online":["yes","no","unknown"]};
 const startupPhases={"account":["auth_sdk_start","auth_sdk_ready","auth_verdict","token_start","token_ready","session_start","session_ready","claims_ready"],"avatar":["assets_start","assets_ready","decode_ready","first_frame"]};
 // END GENERATED EVENT CONTRACT
 const empty=()=>({consent:false,marketing:false,revision:0,expires:0,visitor:null,visitorUntil:0,touch:null});
 const uuidPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
 const health={overflow:0,expired:0,rejected:0,storageFailures:0};
 const startupOffsets=Object.values(startupPhases).flat().map(p=>p+'_ms');
 const startupFields=['startup_scope','startup_outcome','visibility','timing_status','phase','boot_ms','hidden_ms',...startupOffsets];
 // D2 exact spans (worker 51ebcac4): 1..20 ascending, non-overlapping [start,end] ms offsets ≤ 0 from `at`.
 function validSpans(v){if(!Array.isArray(v)||!v.length||v.length>20)return false;let prev=-Infinity;
  for(const p of v){if(!Array.isArray(p)||p.length!==2||!Number.isSafeInteger(p[0])||!Number.isSafeInteger(p[1])||p[0]<-1800000||p[1]>0||p[0]>=p[1]||p[0]<prev)return false;prev=p[1];}return true;}
 function safeProps(props){if(!props||typeof props!=='object'||Array.isArray(props))return null;const out={};for(const[k,v]of Object.entries(props)){
  if(k==='boot_ms'||k==='hidden_ms'||startupOffsets.includes(k)){if(!Number.isSafeInteger(v)||v<0||v>(k==='boot_ms'?604800000:1800000))return null;out[k]=v;}
  else if(k==='media_time_ms'||k==='media_duration_ms'){if(!Number.isSafeInteger(v)||v<0||v>3600000)return null;out[k]=v;}
  else if(k==='asset_attempt'){if(!Number.isSafeInteger(v)||v<1||v>2)return null;out[k]=v;}
  else if(k==='turn_attempt'){if(!Number.isSafeInteger(v)||v<1||v>2147483647)return null;out[k]=v;}
  else if(k==='duration_ms'||k==='piece'){if(!Number.isFinite(v)||v<0||k==='piece'&&v>80)return null;out[k]=Math.round(k==='duration_ms'?Math.min(v,1800000):v);}
  else if(k==='spans_ms'){if(!validSpans(v))return null;out[k]=v.map(p=>[p[0],p[1]]);}
  else if(k==='client_app_version'&&/^[a-f0-9]{64}$/.test(v))out[k]=v;
  else if(k==='error_frame'){if(typeof v!=='string'||!/^[A-Za-z0-9_.-]{1,64}\.js:[0-9]{1,7}:[0-9]{1,7}$/.test(v))return null;out[k]=v;}
  else if(k==='http_status'){if(!Number.isInteger(v)||v<400||v>599)return null;out[k]=v;}
  else if(k==='token_ms'){if(!Number.isInteger(v)||v<0||v>60000)return null;out[k]=v;}
  else if(k==='error_fp'){if(typeof v!=='string'||!/^[a-f0-9]{8}$/.test(v))return null;out[k]=v;}
  else if(['voice_pieces','voice_started','voice_completed','voice_failed','voice_text_only'].includes(k)){if(!Number.isSafeInteger(v)||v<0||v>80)return null;out[k]=v;}
  else if(k==='voice_attempt'){if(!Number.isInteger(v)||v<0||v>1)return null;out[k]=v;}
  else if(k==='voice_media'){if(!Number.isSafeInteger(v)||v<0||v>50)return null;out[k]=v;} // rel44: pieces played via the R53 media element (contract 0–50)
  else if(['call_turns','call_failures','call_silences'].includes(k)){if(!Number.isSafeInteger(v)||v<0||v>500)return null;out[k]=v;}
  else if(['voice_audio_ms','voice_load_ms','voice_load_wall_ms','voice_load_return_ms'].includes(k)){if(!Number.isSafeInteger(v)||v<0||v>1800000)return null;out[k]=v;}
  else if(k==='audio_exposure'){if(!Number.isSafeInteger(v)||v<0||v>3)return null;out[k]=v;}
  else if(k==='audio_context_seq'){if(!Number.isSafeInteger(v)||v<1||v>4096)return null;out[k]=v;}
  else if(k==='audio_clock_delta_ms'||k==='audio_window_ms'||k==='audio_age_ms'){if(!Number.isFinite(v)||v<0)return null;out[k]=Math.min(1800000,Math.round(v/10)*10);}
  else if(k==='feature'?features.has(v):Object.hasOwn(dimensions,k)?dimensions[k].includes(v):['experiment','variant'].includes(k)&&validId(v))out[k]=v;else return null;
 }return out;}
 function safeStartup(e){
  const p=e.props,start=e.name==='experience.startup_started',phases=startupPhases[p.startup_scope];
  if(!Array.isArray(phases)||typeof e.trace!=='string'||!uuidPattern.test(e.trace)||!dimensions.load_kind.includes(p.load_kind)||!dimensions.visibility.includes(p.visibility)||!Number.isSafeInteger(p.boot_ms)||p.boot_ms<0||p.boot_ms>604800000)return false;
  const common=['startup_scope','load_kind','visibility','boot_ms','client_app_version'],keys=start?common:[...common,'startup_outcome','phase','error','stage','timing_status','duration_ms','hidden_ms','failure_reason','auth_error','avatar_wait_reason','avatar_load_step','asset_resource','asset_phase','asset_attempt','asset_error_kind','asset_browser_online','http_status',...phases.map(x=>x+'_ms')];
  if(Object.keys(p).some(k=>!keys.includes(k)))return false;if(start)return true;
  const sessionHeaders=p.startup_scope==='account'&&p.phase==='session_headers';
  if(!dimensions.startup_outcome.includes(p.startup_outcome)||!dimensions.timing_status.includes(p.timing_status)||(!['started',...phases].includes(p.phase)&&!sessionHeaders)||(p.startup_outcome==='failed'?!dimensions.error.includes(p.error):p.error!=null))return false;
  if(p.startup_scope==='avatar'&&p.startup_outcome==='completed'&&p.phase!=='first_frame')return false;
  if(p.timing_status==='overflow')return !['duration_ms','hidden_ms',...startupOffsets].some(k=>k in p);
  if(!Number.isSafeInteger(p.duration_ms)||p.duration_ms<0||p.duration_ms>1800000||!Number.isSafeInteger(p.hidden_ms)||p.hidden_ms<0||p.hidden_ms>p.duration_ms)return false;
  let prior=0,last='started';for(const phase of phases){const value=p[phase+'_ms'];if(value==null)continue;if(!Number.isSafeInteger(value)||value<prior||value>p.duration_ms)return false;prior=value;last=phase;}
  return (sessionHeaders?last==='session_start':last===p.phase)&&!(p.startup_scope==='avatar'&&p.startup_outcome==='completed'&&last!=='first_frame');
 }
 // Optional lifecycle clocks reuse the original failed piece record; no new events or retry work.
 function voiceLoadWallScope(e){const p=e.props;return e.name==='voice.playback_failed'&&p.failure_reason==='audio_missing'&&['token_initial_failed','token_refresh_failed','fetch_failed','body_failed','http_error','decode_failed'].includes(p.voice_load)&&Number.isInteger(p.voice_attempt)&&p.voice_attempt>=0&&p.voice_attempt<=1&&Number.isInteger(p.voice_load_ms)&&p.voice_load_ms>=0&&p.voice_load_ms<=1800000&&!['success','complete','cancel'].includes(p.outcome);}
 function safeVoiceLoadWall(e){const p=e.props;if(!(['voice_load_wall_ms','voice_load_return_ms'].some(k=>k in p)||(e.name==='voice.playback_failed'&&'hidden_ms' in p)))return true;return voiceLoadWallScope(e)&&'voice_load_wall_ms' in p&&'hidden_ms' in p&&p.hidden_ms<=p.voice_load_wall_ms&&(!('voice_load_return_ms' in p)||(p.visibility==='visible'&&p.voice_load_return_ms<=p.voice_load_wall_ms));}
 function safeDiagnosticScopes(e){const p=e.props;if(!safeVoiceLoadWall(e))return false;if('turn_attempt' in p&&!['conversation.turn_completed','conversation.turn_failed'].includes(e.name))return false;const asset=e.name==='experience.startup_resolved'&&p.startup_scope==='avatar'&&p.startup_outcome==='failed'&&p.phase==='assets_start';if(('asset_phase' in p||'asset_attempt' in p)&&(!asset||!('asset_resource' in p)||!('asset_phase' in p&&'asset_attempt' in p)||('http_status' in p&&p.asset_phase!=='headers')))return false;if(('asset_error_kind' in p||'asset_browser_online' in p)&&(!asset||!('asset_resource' in p)||!('asset_phase' in p)||!('asset_attempt' in p)))return false;return (!('call_capture_error' in p)||(e.name==='call.failed'&&p.call_stage==='capture'&&p.call_failure==='unavailable'&&!('call_mic_error' in p)))&&(!('call_mic_error' in p)||(e.name==='call.failed'&&p.call_failure==='unavailable'&&['permission','capture'].includes(p.call_stage)))&&(!['voice_load_ms','voice_first_stage','voice_first_error'].some(k=>k in p)||(e.name==='voice.playback_failed'&&typeof p.voice_load==='string'))&&(!('voice_first_stage' in p||'voice_first_error' in p)||(p.voice_attempt===1&&'voice_first_stage' in p&&'voice_first_error' in p))&&(!['media_time_ms','media_duration_ms','media_paused'].some(k=>k in p)||(e.name==='voice.playback_failed'&&p.voice_output==='media'&&p.failure_reason==='output_stalled'))&&(!('avatar_load_step' in p)||(e.name==='experience.startup_resolved'&&p.startup_scope==='avatar'&&p.startup_outcome==='failed'&&p.phase==='assets_ready'))&&(!('asset_resource' in p)||asset)&&(e.name!=='experience.startup_resolved'||!('http_status' in p)||asset)&&(!('avatar_wait_reason' in p)||(e.name==='experience.startup_resolved'&&p.startup_scope==='avatar'&&p.startup_outcome==='failed'&&p.phase==='decode_ready'))&&(!('voice_media_terminal' in p)||(e.name==='voice.playback_failed'&&p.voice_output==='media'&&(p.failure_reason==='output_stalled'||p.failure_reason==='start_failed'&&['play_rejected','media_error','ended_early','deadline','unknown'].includes(p.voice_media_terminal))))&&(!('audio_error' in p)||e.name==='experience.audio_output'||(e.name==='voice.playback_failed'&&p.voice_output==='media'&&p.failure_reason==='start_failed'));}
 function safeEvent(e){return e&&Object.keys(e).every(k=>['id','name','at','session','trace','props'].includes(k))&&uuidPattern.test(e.id)&&names.has(e.name)&&Number.isSafeInteger(e.at)&&e.at>Date.now()-DAY&&e.at<=Date.now()+300000&&uuidPattern.test(e.session)&&(!e.trace||uuidPattern.test(e.trace))&&safeProps(e.props)&&safeDiagnosticScopes(e)&&(e.name.startsWith('experience.startup_')?safeStartup(e):!startupFields.some(k=>k in e.props&&!((['experience.audio_output','experience.boot_timeout','voice.playback_failed'].includes(e.name)&&k==='visibility')||(k==='hidden_ms'&&voiceLoadWallScope(e)))))&&(!(e.props.observation==='current_state')||(['experience.app_ready','experience.avatar_ready'].includes(e.name)&&e.trace==null&&!('duration_ms' in e.props)))&&(!(e.name==='engagement.interval')||(e.props.feature&&e.props.engagement&&Number.isInteger(e.props.duration_ms)&&e.props.duration_ms<=300000&&(!e.props.spans_ms||e.props.spans_ms.reduce((n,p)=>n+p[1]-p[0],0)===e.props.duration_ms)))&&(e.name==='engagement.interval'||!e.props.spans_ms);}
 // Memory-only flag (EU/EEA "Essential only", see save()): declared before read() runs at load.
 const MEMORY_ONLY='ny.measurement.memoryOnly.v1';
 let volatile=(()=>{try{return localStorage.getItem(MEMORY_ONLY)==='1';}catch{return false;}})(),policyEu=null;
 const read=()=>{if(volatile){try{localStorage.removeItem(KEY);}catch{}return {...empty(),basis:'choice',consent:false,marketing:false,revision:1,expires:Date.now()+90*DAY};}try{const s=JSON.parse(localStorage.getItem(KEY)||'null');if(s&&(s.expires>Date.now()||s.revision>0&&s.consent===false)&&typeof s.consent==='boolean')return s.scope===5?s:s.scope===4?{...s,scope:5,revision:Math.max(Date.now(),s.revision+1)}:{...s,scope:5,marketing:false,ads:null,revision:Math.max(Date.now(),s.revision+1)};}catch{}return empty();};
 let state=read(),queue=[],timer,timerKind=null,heldTimer=null,firstTurn=null,activeTrace=null,token=null,inflight=null,controller=null,membership=null,membershipPending=null;
 const traceClocks=new Map();
 let pendingTouch=null,pendingTouchKey=null,pendingClicks={},pendingSignup=null,automaticApproved=false,policyVerified=false;
 let staleBumped=false,retryCount=0,retryAfter=0,authGeneration=0,latestAuth=null,accountScope=null,entryActive=true;const exposed=new Map();
 let finishHandoff;const handoffReady=window.__nyHandoffToken?new Promise(resolve=>{finishHandoff=resolve;}):Promise.resolve();
 const readiness=new Map(),readinessSent=new Map(),startupAttempts=new Set();let readinessSerial=0,avatarGeneration=0,startupCount=0;
 addEventListener('pagehide',()=>{for(const attempt of startupAttempts)attempt.hide();}); // before the collector's own pagehide flush
 let confirmedIdentity=null,bindingNeeded=false,bindingWork=null,bindingTimer=null,bindingAttempts=0,bindingController=null,bindingDone=null;
 const session=uuid(),nativeFetch=window.fetch.bind(window),entry=new URLSearchParams(location.search),entryAt=Date.now();
 function cleanEntryUrl(){
  // Only after a successful first-party receipt. Keep the immutable entry
  // snapshot for matching; never remove auth, checkout, QA or feature params.
  try{const u=new URL(location.href);if(!['/app','/app/'].includes(u.pathname))return;
   const keys=['utm_source','utm_medium','utm_campaign','utm_content','utm_term','utm_id','ny_adgroup','ny_ad','ny_experiment','ny_variant','ny_account_id','ny_campaign_id','ny_adgroup_id','ny_ad_id','creative_set_id','ny_creative_set_id','fbclid','ttclid','twclid','gclid','gbraid','wbraid'];
   let changed=false;for(const key of keys){if(!entry.has(key)||JSON.stringify(u.searchParams.getAll(key))!==JSON.stringify(entry.getAll(key)))continue;
    u.searchParams.delete(key);changed=true;
   }if(changed)history.replaceState(history.state,'','/app/'+u.search+u.hash);
  }catch{/* Cosmetic cleanup must never affect ingestion or navigation. */}
 }
 // Forward-only exact URL evidence; never apply this map to restored touches.
 const X_FORWARD={version:'x-restart-20260922-v1',since:Date.parse('2026-09-21T18:30:23Z'),
  provenance:'Social Media/adops/reports/x-restart-routing-20260922.json',
  sha256:'dc3411f934c72a0445dcef60696db96ac2c57fc11197157cb37680cffaced4f3',
  rows:[
   ['demo-v8-mobile','xmecp','b5gmg5'],['nari-interview-v8-mobile','xmecp','b5gmg7'],
   ['sisters-static-mobile','xmecp','b5gmg8'],['nari-interview-v8-desktop','xmecq','b5gmg9'],
   ['demo-v8-desktop','xmecq','b5gmga'],['yume-interview-v8-desktop','xmecq','b5gmgb'],
   ['pip-v12-desktop','xmecq','b5gmgc'],['sisters-static-desktop','xmecq','b5gmgd']
  ]};
 function resolveXEntry(out){
  const keys=['utm_source','utm_medium','utm_campaign','utm_content'];
  if(entryAt<X_FORWARD.since||keys.some(k=>entry.getAll(k).length!==1)||
   [...entry.keys()].some(k=>k.startsWith('utm_')&&!keys.includes(k)&&k!=='utm_id')||
   entry.get('utm_source')!=='x'||entry.get('utm_medium')!=='paid_social'||entry.get('utm_campaign')!=='ny-p01-20260913')return;
  const matches=X_FORWARD.rows.filter(r=>r[0]===entry.get('utm_content'));if(matches.length!==1)return;
  const [,group,ad]=matches[0],ids={account_id:'18ce55wgrt5',campaign_id:'p9id5',adgroup_id:group,ad_id:ad};
  // Consistent explicit IDs are retained; any duplicate/invalid/conflicting
  // explicit ID vetoes enrichment, including an overridden utm_id alias.
  for(const [query,key]of Object.entries({utm_id:'campaign_id',ny_account_id:'account_id',ny_campaign_id:'campaign_id',ny_adgroup_id:'adgroup_id',ny_ad_id:'ad_id'})){
   if(entry.has(query)&&(entry.getAll(query).length!==1||entry.get(query)!==ids[key]))return;
  }
  Object.assign(out,ids);
 }
 const inApp=location.pathname==='/app'||location.pathname.startsWith('/app/');
 // 9 Oct 2026 (owner, EU/EEA ONLY): an EU/EEA visitor who chose "Essential only" keeps product-measurement state in
 // memory only: no visitor id, touch or queued event is written to device storage, and any already there is removed.
 // One flag remembers the choice across loads (strictly necessary, like the bar answer). "Allow" restores normal storage.
 // Everywhere else (incl. UK/CH/Quebec) is unchanged. Events still send; each page load is then a new in-memory visitor.
 const save=()=>{if(volatile)return;try{localStorage.setItem(KEY,JSON.stringify(state));}catch{}};
 // Owner rule (2026-09-27): first-party product measurement (usage steps, timings,
 // errors; never conversations or audio) is part of the service under the Terms,
 // for everyone. `consent`/`marketing` now govern ONLY advertising: ad cookies,
 // click IDs and sharing with ad platforms keep their regional default, explicit
 // choice and Global Privacy Control rules, unchanged.
 const allowed=()=>true;
 const adConsent=()=>state.expires>Date.now()&&state.consent===true&&(state.basis!=='automatic'||automaticApproved)&&navigator.globalPrivacyControl!==true;
 const adsAllowed=()=>adConsent()&&state.marketing===true;
 const membershipMarketing=()=>adsAllowed()||!policyVerified&&state.basis==='automatic'&&state.consent===true&&state.marketing===true&&state.expires>Date.now()&&navigator.globalPrivacyControl!==true;
 const OUTBOX='ny.measurement.pending.v1.';
 // Display names are not provider IDs. Keep the shared strict ID grammar for
 // joins; permit bounded printable names without accepting unresolved macros.
 const touchValue=(key,value)=>['campaign','adgroup','ad'].includes(key)
  ?typeof value==='string'&&value.length>0&&value.length<=120&&!/[\p{C}<>{}]/u.test(value)
  :validId(value);
 const safeSignup=r=>r&&Object.keys(r).every(k=>['at','expires','signature','cohort'].includes(k))&&Number.isSafeInteger(r.at)&&r.at>=Date.now()-90*DAY&&r.at<=Date.now()&&Number.isSafeInteger(r.expires)&&r.expires>Date.now()&&r.expires<=Date.now()+DAY&&/^[a-f0-9]{64}$/.test(r.signature||'')&&[null,'qa','tester','permanent_premium'].includes(r.cohort);
 const safeTouch=t=>t&&Number.isSafeInteger(t.at)&&t.at>Date.now()-30*DAY&&t.at<=Date.now()&&Object.entries(t).every(([k,v])=>k==='at'||['source','medium','campaign','creative','adgroup','ad','experiment','variant','account_id','campaign_id','adgroup_id','ad_id','creative_set_id'].includes(k)&&touchValue(k,v));
 const CLICK_KEYS=['fbclid','ttclid','twclid','gclid','gbraid','wbraid'];
 // AppLovin's pixel was removed (2026-09-28): its old keys in saved or queued
 // records are dropped, so they never invalidate the rest of the attribution.
 const currentClicks=c=>c&&typeof c==='object'&&!Array.isArray(c)?Object.fromEntries(Object.entries(c).filter(([k])=>k!=='aleid'&&k!=='alart')):c;
 const safeClicks=c=>{c=currentClicks(c);return c&&typeof c==='object'&&!Array.isArray(c)&&Object.entries(c).every(([k,v])=>CLICK_KEYS.includes(k)&&typeof v==='string'&&/^[A-Za-z0-9_.~-]{1,500}$/.test(v));};
 const vendor=(method,...args)=>{try{window.__nyAdPixels?.[method]?.(...args);}catch{}};
 // One immutable record per event: another tab never replaces our queue. Auth
 // credentials and response bodies are never persisted. Account scope is a
 // local salted digest, used only to prevent cross-account replay.
 function records(){const out=[];try{const keys=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i));for(const key of keys)if(key?.startsWith(OUTBOX)){try{const value=JSON.parse(localStorage.getItem(key));if(value.until>Date.now())out.push([key,value]);else{localStorage.removeItem(key);health.expired++;}}catch{localStorage.removeItem(key);health.rejected++;}}}catch{}return out;}
 function removeRecord(id){try{localStorage.removeItem(OUTBOX+id);}catch{}}
 function purge(){for(const[key]of records())try{localStorage.removeItem(key);}catch{}}
 function persist(id,data){if(!allowed()||volatile)return;try{localStorage.setItem(OUTBOX+id,JSON.stringify({visitor:state.visitor,revision:state.revision,scope:state.accountScope||null,until:Date.now()+DAY,...data}));}catch{health.storageFailures++;}}
 function restore(){if(!allowed())return;if(volatile){purge();return;}for(const[key,r]of records()){
  // Product records survive ad-choice revision bumps (Codex F3, 2026-09-28); only
  // click IDs stay bound to the revision they were captured under.
  if(r.visitor!==state.visitor)continue;
  if(r.scope&&r.scope!==accountScope)continue;
  if(r.event){if(!safeEvent(r.event)){removeRecord(key.slice(OUTBOX.length));health.rejected++;continue;}if(!queue.some(e=>e.id===r.event.id)&&queue.length<100)queue.push(r.event);}
  if(r.signup&&accountScope&&r.scope===accountScope){if(safeSignup(r.signup))pendingSignup=r.signup;else{removeRecord(key.slice(OUTBOX.length));health.rejected++;}}
  if(r.binding===1&&accountScope&&r.scope===accountScope)bindingNeeded=true;
  if(r.touch&&!pendingTouch){if(safeTouch(r.touch)&&safeClicks(r.clicks||{})){pendingTouch=r.touch;pendingTouchKey=key.slice(OUTBOX.length);pendingClicks=adsAllowed()&&r.revision===state.revision?currentClicks(r.clicks||{}):{};}else{removeRecord(key.slice(OUTBOX.length));health.rejected++;}}
 }}
 function visitor(){if(!allowed())return null;if(!state.visitor||state.visitorUntil<Date.now()){state.visitor=uuid();state.visitorUntil=Date.now()+DAY;save();}return state.visitor;}
 function touch(){const out={};for(const[q,k]of Object.entries({utm_source:'source',utm_medium:'medium',utm_campaign:'campaign',utm_content:'creative',ny_adgroup:'adgroup',ny_ad:'ad',ny_experiment:'experiment',ny_variant:'variant',utm_id:'campaign_id',ny_account_id:'account_id',ny_campaign_id:'campaign_id',ny_adgroup_id:'adgroup_id',ny_ad_id:'ad_id',creative_set_id:'creative_set_id',ny_creative_set_id:'creative_set_id'})){if(q==='creative_set_id'&&entry.has('ny_creative_set_id'))continue;let v=entry.get(q)?.trim();if(k==='source'||k==='medium')v=v?.toLowerCase();if(touchValue(k,v))out[k]=v;}out.source=({facebook:'meta',instagram:'meta',threads:'meta',twitter:'x',fb:'meta',ig:'meta',tt:'tiktok',youtube:'google',yt:'google'})[out.source]||out.source;if(out.source==='applovin'&&out.medium==='paid')out.medium='paid_social';resolveXEntry(out);return out.source?{...out,at:entryAt}:null;}
 function retainTouch(){
  const old=state.touch?.at>=Date.now()-30*DAY&&state.touch.at<=Date.now()?state.touch:null,incoming=entryActive?touch():null;
  const same=old&&incoming&&Object.entries(incoming).every(([k,v])=>k==='at'||old[k]===v)&&Object.keys(old).length===Object.keys(incoming).length;
  state.touch=incoming?(same?old:incoming):old;save();
  if(state.touch){const key='touch-'+state.visitor+'-'+state.touch.at,existing=records(),saved=existing.find(([k])=>k===OUTBOX+key)?.[1];if(saved||existing.filter(([,r])=>r.touch).length<20){if(!saved)persist(key,{touch:state.touch,clicks:clicks(),until:state.touch.at+30*DAY});if(!pendingTouch){pendingTouchKey=key;pendingClicks=adsAllowed()?(saved?.clicks||clicks()):{};}}else health.overflow++;}
  return pendingTouch||state.touch;
 }
 function clicks(){const out={};if(adsAllowed()&&entryActive)for(const k of CLICK_KEYS){const v=entry.get(k);if(v&&/^[A-Za-z0-9_.~-]{1,500}$/.test(v))out[k]=v;}return out;}
 function retainClicks(){const incoming=clicks();if(Object.keys(incoming).length){const same=state.ads?.until>Date.now()&&Object.entries(incoming).every(([k,v])=>state.ads.values[k]===v);if(!same)state.ads={values:incoming,until:Date.now()+30*DAY};}else if(!(state.ads?.until>Date.now()))state.ads=null;save();}
 function adClickParams(){return adsAllowed()&&state.ads?.until>Date.now()?{...currentClicks(state.ads.values)}:{};}
 function enableAutomaticAds(s){
  if(!automaticApproved||state.basis!=='automatic'||!adConsent()||state.marketing||
   !s?.account?.uid||
   s?.measurement?.excluded||['qa','tester','permanent_premium'].includes(s?.measurement?.signupReceipt?.cohort)||
   s?.entitlement?.sources?.includes('testing'))return;
  const prior=state.revision,next=Math.max(Date.now(),prior+1),id=state.visitor;
  controller?.abort();state.marketing=true;state.revision=next;membership=null;
  // Keep first-party observations made while the account was loading. Only the
  // permission revision changes; event IDs and the original touch do not.
  for(const [key,record]of records())if(record.visitor===id&&record.revision===prior){
   try{localStorage.setItem(key,JSON.stringify({...record,revision:next}));}catch{health.storageFailures++;}
  }
  retainClicks();
  if(state.touch){
   const key='touch-'+id+'-'+state.touch.at;
   pendingTouch=state.touch;pendingTouchKey=key;pendingClicks=clicks();
   persist(key,{touch:state.touch,clicks:pendingClicks,until:state.touch.at+30*DAY});
  }
  save();
 }
 let appVersion=null,versionStarted=false;
 function observeAppVersion(){if(versionStarted||!crypto?.subtle)return;try{const script=[...(document.scripts||[])].find(s=>/\/app\/assets\/index-[\w-]+\.js$/.test(new URL(s.src||location.href,location.href).pathname));if(!script)return;versionStarted=true;void crypto.subtle.digest('SHA-256',new TextEncoder().encode(new URL(script.src,location.href).pathname)).then(b=>{appVersion=Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('');}).catch(()=>{});}catch{/* Version metadata must not interrupt collection. */}}
 // One writer per checkout return (R6, Codex reviews 1 Oct): the tab that loads
 // the return URL reports it here; the app tab only rechecks the account.
 // Keys shared with app-src billingWindow.ts / App.tsx. Dedupe is the reported
 // marker alone (attempt id, or 'url:<outcome>' for an unidentified return,
 // cleared by App once it consumes the URL), set ONLY after event() accepted the
 // return. A refused enqueue (full queue, collection off, invalid) keeps the
 // attempt and retries after the next flush frees capacity, at most 3 times.
 let returnRetry=null;
 function checkoutReturned(outcome,tries=0){
  let a=null,plan=null,key=null;
  try{const s=sessionStorage;
   try{a=JSON.parse(s.getItem('ny.checkoutAttempt')||'null');}catch{}
   // Identity: a fresh record, or a legacy one without a timestamp (older bundle).
   if(!(a&&typeof a.id==='string'&&(a.at===undefined||a.at>Date.now()-DAY)))a=null;
   key=a?a.id:'url:'+outcome;
   if(s.getItem('ny.checkoutReported')===key)return;
   // Plan only from a fresh record — never guessed from a stale or legacy one.
   if(a&&a.at>Date.now()-DAY&&dimensions.plan.includes(a.plan))plan=a.plan;
  }catch{}
  if(!event('commerce.checkout_returned',plan?{outcome,plan}:{outcome},null)){
   returnRetry=tries<3?()=>{returnRetry=null;checkoutReturned(outcome,tries+1);}:null;return;
  }
  returnRetry=null;
  try{if(key)sessionStorage.setItem('ny.checkoutReported',key);}catch{}
  try{window.dispatchEvent(new CustomEvent('ny:checkout-return-queued',{detail:{attempt:a?.id??null}}));}catch{}
 }
 // 9 Oct (owner: full landing→signup visibility): coarse, closed-enum browser context on the three pre-app events,
 // so a stall or crash before the first screen can be split by engine, in-app browser and network. No UA string leaves.
 const ENV_EVENTS=new Set(['acquisition.landing_observed','experience.boot_timeout','experience.client_error']);
 function clientEnv(){try{const ua=navigator.userAgent||'',ios=/iPhone|iPad|iPod/.test(ua);
  const in_app=/TikTok|musical_ly|Bytedance/i.test(ua)?'tiktok':/Instagram/i.test(ua)?'instagram':/FBAN|FBAV|FB_IAB/.test(ua)?'facebook':/Twitter/i.test(ua)?'x':/\bLine\//.test(ua)?'line':/Snapchat/i.test(ua)?'snapchat':/; wv\)/.test(ua)?'other':'none';
  const browser_engine=ios?'webkit':/Firefox\//.test(ua)?'gecko':/Chrome\/|Chromium\/|Edg\/|OPR\//.test(ua)?'blink':/Safari\//.test(ua)?'webkit':'other';
  const t=navigator.connection?.effectiveType,net_type=t==='4g'||t==='3g'||t==='2g'?t:t==='slow-2g'?'slow_2g':'unknown';
  return {browser_engine,in_app,net_type};}catch{return {};}}
 function event(name,props={},trace=activeTrace,at=Date.now()){
  if(!names.has(name))return false;
  if(ENV_EVENTS.has(name))props={...clientEnv(),...props};
  // EU memory-only visitors (R55) reload as new visitors; tag their early events so people-counts can split them out.
  if(volatile&&(ENV_EVENTS.has(name)||name==='auth.client_resolved'))props={...props,memory_only:'yes'};
  if(name==='experience.app_ready'||name==='experience.startup_started')bootSeen=true;
  if(!inApp&&name!=='acquisition.landing_observed')return false;
  if(name==='funnel.stage_exposed')exposed.set(name,{...props});
  const ready=['experience.app_ready','experience.avatar_ready'].includes(name);
  if(ready&&props.observation!=='current_state')readiness.set(name,{version:++readinessSerial,props:dimensions.load_kind.includes(props.load_kind)?{load_kind:props.load_kind}:{}});
  // Audio-output diagnostics are first-party only: never offered to ad pixels,
  // capped below real events, and evicted first when the outbox is full.
  const diagnostic=name==='experience.audio_output';
  if(!diagnostic)vendor('event',name,props);
  if(!allowed())return false;restore();
  if(diagnostic&&queue.length>=60){health.overflow++;return false;}
  if(!diagnostic&&queue.length>=100){const k=queue.findIndex(e=>e.name==='experience.audio_output');if(k>=0){removeRecord(queue[k].id);queue.splice(k,1);}}
  if(queue.length>=100||records().filter(([,r])=>r.event).length>=100){health.overflow++;return false;}
  if((name.startsWith('conversation.')||name.startsWith('voice.'))&&!trace)return false;
  if(trace&&traceClocks.has(trace)&&!('duration_ms' in props))props={...props,duration_ms:performance.now()-traceClocks.get(trace).at};
  // Reuse the observed build hash on failed startups only; no extra event, hash or request.
  observeAppVersion();if(appVersion&&(!name.startsWith('experience.startup_')||(name==='experience.startup_resolved'&&props.startup_outcome==='failed')))props={...props,client_app_version:appVersion};
  const out=safeProps(props);if(!out){health.rejected++;return false;}
  if(trace&&!uuidPattern.test(trace))return false;
  visitor();const item={id:uuid(),name,at,session,...(trace?{trace}:{}),props:out};if(!safeEvent(item)){health.rejected++;return false;}queue.push(item);persist(item.id,{event:item});
  if(ready)readinessSent.set(name,state.revision+':'+readiness.get(name)?.version);
  schedule(item);
  return true;
 }
 // Visit-record flush contract (COST-VISIT-RECORD-SPEC-20261004 rev 2). Critical events keep the
 // <=3 s flush (speech still coalesces within it). Everything else is held and sent at the earliest
 // of: 30 s after the oldest held event, 20 queued (one POST's cap), hide/pagehide, or any critical
 // flush (held events ride along). Persistence, outbox cap, restore and retry are unchanged.
 const HOLD_MS=30000,POST_CAP=20,urgent=new WeakSet(),heldAt=new WeakMap();
 const CRITICAL=new Set(['acquisition.landing_observed','experience.client_error','experience.boot_timeout','conversation.turn_failed','call.failed','voice.playback_failed','game.abandoned',
  'experience.startup_started','experience.startup_resolved','experience.app_ready','experience.avatar_ready']);
 function critical(e){
  if(CRITICAL.has(e.name)||/^(funnel|auth|commerce)\./.test(e.name)||['error','failed','timeout'].includes(e.props.outcome))return true;
  // The session's first turn (every event carrying its trace) is an activation denominator.
  if(e.name==='conversation.submit'&&e.trace&&!firstTurn)firstTurn=e.trace;
  return !!e.trace&&e.trace===firstTurn;
 }
 function armHeld(){
  if(heldTimer)return;const now=performance.now();let oldest=now;for(const e of queue)oldest=Math.min(oldest,heldAt.get(e)??now);
  heldTimer=setTimeout(()=>{heldTimer=null;if(retryCount&&timer)return;void flush();},Math.max(0,HOLD_MS-(now-oldest)));
 }
 function schedule(item){
  if(critical(item)){urgent.add(item);if(!timer){timerKind='critical';timer=setTimeout(()=>{timer=null;void flush();},3000);}return;}
  heldAt.set(item,performance.now());
  if(queue.length>=POST_CAP&&!(retryCount&&timer)){if(heldTimer){clearTimeout(heldTimer);heldTimer=null;}void flush();return;}
  armHeld();
 }
 function snapshotReadiness(){
  if(!allowed()||document.hidden)return;
  for(const[name,value]of readiness)if(readinessSent.get(name)!==state.revision+':'+value.version)event(name,{...value.props,observation:'current_state'},null);
 }
 function startup(scope,kind='initial'){bootSeen=true;
  const ownedAvatar=scope==='avatar'?++avatarGeneration:null;
  const invalidateReadiness=()=>{if(ownedAvatar===avatarGeneration)readiness.delete('experience.avatar_ready');};
  if(scope==='avatar')invalidateReadiness();
  const noop={mark(){},finish(){},invalidateReadiness};
  const phases=startupPhases[scope],at=performance.now();
  if(!Array.isArray(phases)||!dimensions.load_kind.includes(kind)||!allowed()||!inApp||!Number.isFinite(at)||at<0||at>604800000)return noop;
  if(startupAttempts.size>=32||startupCount>=128){health.overflow++;return noop;}startupCount++;
  const trace=uuid(),revision=state.revision,owner=visitor(),boot=Math.round(at),offsets={};let last=-1,sessionHeaders=false,ended=false,hidden=0,hiddenAt=document.hidden?at:null,lastClock=at;
  const current=()=>!ended&&allowed()&&state.revision===revision&&state.visitor===owner;
  const clock=()=>{const now=performance.now();if(!Number.isFinite(now)||now<lastClock){health.rejected++;return null;}lastClock=now;return now;};
  const base=()=>({startup_scope:scope,load_kind:kind,boot_ms:boot,visibility:document.hidden?'hidden':'visible'}),begun=base();let announced=false;
  const attempt={
   // The terminal implies the start (D3); a start is sent only if the page hides or unloads first.
   hide(){if(announced||!current())return;announced=true;event('experience.startup_started',begun,trace);},
   visibility(){if(document.hidden)attempt.hide();const now=clock();if(now==null)return;if(hiddenAt!=null)hidden+=now-hiddenAt;hiddenAt=document.hidden?now:null;},
   // Headers refine the current session request only, without adding offsets.
   // A retry resets this phase; keep the original session_start_ms boundary.
   mark(phase){if(!current())return;if(scope==='account'&&phase==='session_headers'){if(phases[last]!=='session_start'){health.rejected++;return;}if(clock()!=null)sessionHeaders=true;return;}const i=phases.indexOf(phase);if(i===last){if(scope==='account'&&phase==='session_start')sessionHeaders=false;return;}if(i<0||i<last){health.rejected++;return;}const now=clock();if(now==null)return;last=i;sessionHeaders=false;offsets[phase+'_ms']=Math.round(now-at);},
   finish(outcome,error,stage,reason,authError,avatarWaitReason,assetFailure,avatarLoadStep){
    if(!current()){ended=true;startupAttempts.delete(attempt);return;}
    if(!dimensions.startup_outcome.includes(outcome)||stage!=null&&!dimensions.stage.includes(stage)||error!=null&&!dimensions.error.includes(error)||outcome==='completed'&&scope==='avatar'&&phases[last]!=='first_frame'){health.rejected++;return;}
    const now=clock();if(now==null)return;ended=true;startupAttempts.delete(attempt);
    const duration=Math.round(now-at),hiddenMs=Math.round(hidden+(hiddenAt==null?0:now-hiddenAt));
    event('experience.startup_resolved',{...base(),startup_outcome:outcome,phase:sessionHeaders?'session_headers':phases[last]||'started',...(outcome==='failed'?{error:error||'unknown',...(dimensions.failure_reason.includes(reason)?{failure_reason:reason}:{}),...(scope==='account'&&dimensions.auth_error?.includes(authError)?{auth_error:authError}:{}),...(scope==='avatar'&&phases[last]==='decode_ready'&&dimensions.avatar_wait_reason?.includes(avatarWaitReason)?{avatar_wait_reason:avatarWaitReason}:{}),...(scope==='avatar'&&phases[last]==='assets_ready'&&dimensions.avatar_load_step?.includes(avatarLoadStep)?{avatar_load_step:avatarLoadStep}:{}),...(scope==='avatar'&&phases[last]==='assets_start'&&assetFailure&&dimensions.asset_resource.includes(assetFailure.asset_resource)&&(assetFailure.http_status===undefined||Number.isInteger(assetFailure.http_status)&&assetFailure.http_status>=400&&assetFailure.http_status<=599)?{asset_resource:assetFailure.asset_resource,...(assetFailure.http_status===undefined?{}:{http_status:assetFailure.http_status}),...(dimensions.asset_phase.includes(assetFailure.asset_phase)&&Number.isSafeInteger(assetFailure.asset_attempt)&&assetFailure.asset_attempt>=1&&assetFailure.asset_attempt<=2&&(assetFailure.http_status===undefined||assetFailure.asset_phase==='headers')?{asset_phase:assetFailure.asset_phase,asset_attempt:assetFailure.asset_attempt,...(dimensions.asset_error_kind.includes(assetFailure.asset_error_kind)?{asset_error_kind:assetFailure.asset_error_kind}:{}),...(dimensions.asset_browser_online.includes(assetFailure.asset_browser_online)?{asset_browser_online:assetFailure.asset_browser_online}:{})}:{})}:{})}:{}),...(stage?{stage}:{}),...(duration>1800000?{timing_status:'overflow'}:{timing_status:'complete',duration_ms:duration,hidden_ms:hiddenMs,...offsets})},trace);
   },invalidateReadiness,
  };
  startupAttempts.add(attempt);return attempt;
 }
 async function flush(force=false,membershipOnly=false){
  if(inflight){if(!force)return inflight;await inflight;return flush(true,membershipOnly);}
  if(!state.visitor||(!allowed()&&!force))return;
  restore();
  queue=queue.filter(e=>{if(safeEvent(e))return true;removeRecord(e.id);health.expired++;return false;});
  if(pendingSignup&&pendingSignup.expires<=Date.now()){pendingSignup=null;removeRecord('signup-'+state.visitor);health.expired++;}
  if(pendingTouch&&pendingTouch.at<Date.now()-30*DAY){pendingTouch=null;if(pendingTouchKey)removeRecord(pendingTouchKey);pendingTouchKey=null;pendingClicks={};health.expired++;}
  if(!membershipOnly&&latestAuth&&latestAuth!==token&&allowed())return;
  if(state.accountScope&&accountScope!==state.accountScope&&allowed())return;
  const batch=membershipOnly?[]:queue.slice(0,20),revision=state.revision,generation=authGeneration,visitorSent=state.visitor,touchSent=pendingTouch,touchKeySent=pendingTouchKey,clicksSent=pendingClicks,signupSent=!membershipOnly&&token?pendingSignup:null;
  // The gateway may commit the client batch then its signed signup receipt.
  // Its two bounded 10s deliveries fit inside this background-only deadline.
  controller=new AbortController();const requestController=controller,signal=controller.signal,deadline=setTimeout(()=>requestController.abort(),25000);
  inflight=(async()=>{
   try{const r=await nativeFetch('/api/measurement',{method:'POST',headers:{'content-type':'application/json',...(token&&(!latestAuth||token===latestAuth)?{authorization:token}:{})},keepalive:true,signal,
    body:JSON.stringify({visitor:state.visitor,consent:allowed(),marketing:membershipMarketing(),marketingBasis:state.basis||null,revision,attribution:allowed()?touchSent:null,clicks:adsAllowed()?clicksSent:{},events:allowed()?batch:[],...(allowed()&&signupSent?{signupReceipt:signupSent}:{})})});
    if(!r.ok){retryCount++;const wait=r.headers.get('retry-after'),seconds=Number(wait);retryAfter=wait?Math.min(300000,Math.max(0,Number.isFinite(seconds)?seconds*1000:Date.parse(wait)-Date.now())):0;if(r.status===401){token=null;}}
    else if(revision===state.revision&&generation===authGeneration&&visitorSent===state.visitor){const receipt=await r.json();if(revision!==state.revision||generation!==authGeneration||visitorSent!==state.visitor)return;if(receipt.ignored==='stale_consent'&&receipt.stale==='equal_revision_on'&&!staleBumped&&policyVerified&&state.basis==='automatic'&&adsAllowed()&&navigator.globalPrivacyControl!==true){staleBumped=true;state={...state,revision:Math.max(Date.now(),state.revision+1)};save();retryCount=0;retryAfter=0;}
     else if(receipt.ignored||receipt.reason){retryCount++;}else{
     if(allowed()&&(Number.isSafeInteger(receipt.accepted)||Array.isArray(receipt.acknowledged))){membership={visitor:visitorSent,revision};cleanEntryUrl();}
     // Legacy count is safe only when it acknowledges the complete batch.
     const ids=Array.isArray(receipt.acknowledged)?receipt.acknowledged:(receipt.accepted===batch.length?batch.map(e=>e.id):[]);
     const rejected=new Set((Array.isArray(receipt.rejected)?receipt.rejected:[]).filter(id=>batch.some(e=>e.id===id)));
     health.rejected+=rejected.size;
     const ack=new Set([...ids,...rejected].filter(id=>batch.some(e=>e.id===id)));queue=queue.filter(e=>!ack.has(e.id));for(const id of ack)removeRecord(id);
     retryCount=ack.size<batch.length||signupSent&&!receipt.signupRecorded?retryCount+1:0;
     if(pendingTouch===touchSent){pendingTouch=null;pendingTouchKey=null;if(touchKeySent)removeRecord(touchKeySent);}if(pendingClicks===clicksSent)pendingClicks={};
     if(receipt.signupRecorded&&pendingSignup===signupSent){pendingSignup=null;removeRecord('signup-'+visitorSent);}
     restore();
    }}
   }catch{retryCount++;}finally{clearTimeout(deadline);controller=null;}
  })();
  try{await inflight;}finally{inflight=null;if(returnRetry)void Promise.resolve().then(()=>returnRetry?.());
   // Only held events left after a clean send: re-arm their 30 s clock; a spent critical timer is not needed.
   if(heldTimer){clearTimeout(heldTimer);heldTimer=null;}
   if(allowed()&&!retryCount&&!pendingSignup&&!pendingTouch&&queue.length<POST_CAP&&!queue.some(e=>urgent.has(e))){if(timer&&timerKind==='critical'){clearTimeout(timer);timer=null;}if(queue.length&&!timer)armHeld();}
   else if(allowed()&&(queue.length||pendingSignup||pendingTouch)&&!timer)timerKind='drain',timer=setTimeout(()=>{timer=null;void flush();},Math.max(retryAfter||0,retryCount?Math.min(300000,4000*2**Math.min(7,retryCount-1))+Math.random()*1000:3000));void refreshBinding();}
 }
 // Membership work never blocks application transports; receipt binding follows independently after a
 // current authenticated identity and consent membership are both confirmed.
 const membershipReady=()=>allowed()&&membership?.visitor===state.visitor&&membership.revision===state.revision;
 async function ensureMembership(){
  if(!allowed()||!visitor()||state.accountScope&&accountScope!==state.accountScope)return false;
  if(membershipReady())return true;
  pendingTouch??=retainTouch();
  if(!membershipPending){const work=flush(true,true);membershipPending=work;const clear=()=>{if(membershipPending===work)membershipPending=null;};void work.then(clear,clear);}
  let deadline;try{await Promise.race([membershipPending,new Promise(resolve=>{deadline=setTimeout(resolve,750);})]);}catch{}finally{clearTimeout(deadline);}
  return membershipReady();
 }
 // A saved explicit refusal skips loadPolicy, so it never learns the region. Ask once: EU/EEA → memory-only; otherwise
 // remember the answer in the (stored, non-EU) state so this request never repeats.
 async function checkEuRefusal(){if(volatile||state.basis!=='choice'||state.consent!==false||state.euChecked===true)return;
  try{const c=new AbortController(),t=setTimeout(()=>c.abort(),1500);try{const r=await nativeFetch('/api/measurement?policy=1',{signal:c.signal,credentials:'same-origin'});if(!r.ok)return;
   const p=await r.json();if(typeof p.euRegion!=='boolean')return;policyEu=p.euRegion;
    if(volatile||state.basis!=='choice'||state.consent!==false)return; // the visitor chose again while this was in flight
    if(p.euRegion)memoryOnly(true);else{state={...state,euChecked:true};save();}}finally{clearTimeout(t);}}catch{}
 }
 function memoryOnly(on){
  if(on){volatile=true;try{localStorage.setItem(MEMORY_ONLY,'1');localStorage.removeItem(KEY);}catch{}purge();}
  else{volatile=false;try{localStorage.removeItem(MEMORY_ONLY);}catch{}save();}
 }
 async function choose(consent,marketing){
  sampleEngagement(true);
  const prior=state.visitor;
  // An advertising choice (2026-09-27): product measurement, its visitor and its
  // queued events are unaffected; only ad cookies, click IDs and sharing change.
  const ads=!!consent&&!!marketing&&navigator.globalPrivacyControl!==true;
  state={...state,scope:5,basis:'choice',consent:ads,marketing:ads,revision:Math.max(Date.now(),state.revision+1),expires:Date.now()+90*DAY};
  if(!ads){state.ads=null;pendingClicks={};vendor('stop');}else retainClicks();
  if(!ads&&policyEu===true)memoryOnly(true);else if(ads&&volatile)memoryOnly(false);
  else if(!ads&&policyEu===null)void checkEuRefusal(); // region unknown (saved Allow skipped loadPolicy, or GPC): ask once
  membership=null;controller?.abort();
  save();await flush(true);vendor('start');document.getElementById('ny-measurement-panel')?.remove();
  // Consent granted after login still needs the server-signed creation receipt.
  // This is a read-only refresh, never a fabricated browser signup event.
  if(allowed())void resumeIdentity();
 }
 function controlHost(){const dialogs=[...(document.querySelectorAll?.('[role="dialog"][aria-modal="true"]')||[])];return dialogs.at(-1)||document.body;}
 function settings(){
  if(document.getElementById('ny-measurement-panel'))return;
  const p=document.createElement('section');p.id='ny-measurement-panel';p.setAttribute('role','dialog');p.setAttribute('aria-label','Your Privacy Choices');
  p.style.cssText='position:fixed;z-index:1000000;left:50%;bottom:calc(12px + env(safe-area-inset-bottom));transform:translateX(-50%);box-sizing:border-box;width:min(410px,calc(100% - 24px));max-height:70dvh;overflow:auto;background:#fffaf4;color:#443c3b;border:1px solid #e5d8c8;border-radius:18px;padding:18px;box-shadow:0 6px 30px #382b3724;font:14px/1.45 system-ui,sans-serif';
  p.innerHTML='<h2 style="margin:0 0 8px;font-size:18px">Your Privacy Choices</h2><p>Usage measurement (steps, timings and errors) is part of the service under our Terms. It never includes your conversations or audio.</p><label style="display:flex;gap:10px;align-items:center;min-height:44px"><input id="ny-measure-ads" type="checkbox"> Allow advertising cookies and share attribution and conversion events with Meta, TikTok, X and Google</label><p style="font-size:12px">Advertising data may be shared for targeted advertising. Select Essential only to opt out of sale or sharing. With your advertising choice, Meta, TikTok and X may receive a protected account identifier and a SHA-256 hash of your email to match sign-ups and purchases; Google receives conversions by server-side upload. A hash is not anonymous. No raw email, phone number, conversations or audio are shared.</p><p style="font-size:12px">Advertising is optional. Change or withdraw this choice here at any time. <a href="/privacy" target="_blank" rel="noopener">Privacy policy</a></p><div style="display:flex;gap:8px"><button data-choice="deny" type="button">Essential only</button><button data-choice="save" type="button">Save choices</button></div>';
  for(const b of p.querySelectorAll('button'))b.style.cssText='flex:1;min-height:44px;border:1px solid #d9c9b8;border-radius:12px;background:#fff;color:#443c3b;font:600 14px system-ui;cursor:pointer';
  p.addEventListener?.('click',e=>e.stopPropagation());controlHost().append(p);const ads=p.querySelector('#ny-measure-ads');ads.checked=adsAllowed();
  p.querySelector('[data-choice="deny"]').onclick=()=>void choose(false,false);p.querySelector('[data-choice="save"]').onclick=()=>void choose(ads.checked,ads.checked);
 }
 // Monotonic intervals, not wall-clock sessions. A resumed tab never earns
 // hidden time. Reports union overlapping account intervals across tabs.
 let feature='home',intentional=false,lastInput=-Infinity,lastSample=performance.now();
 let wasVisible=!document.hidden,wasFocused=typeof document.hasFocus!=='function'||document.hasFocus();
 // Event diet D2 (2026-10-04, final): ONE engagement.interval per visible stretch of one feature +
 // mode, carrying the EXACT engaged spans (worker 51ebcac4 unions spans_ms). Idle gaps stay gaps.
 // A stretch ends on hide/unload, feature or mode change, ineligibility, or the 5 min / 20 spans /
 // 30 min bounds; `at` is the end of its last engaged span.
 let stretch=null;
 const spanTotal=t=>t.spans.reduce((n,p)=>n+p[1]-p[0],0);
 function flushStretch(){if(!stretch)return;const t=stretch;stretch=null;const at=t.spans.at(-1)[1];
  event('engagement.interval',{feature:t.feature,engagement:t.engagement,duration_ms:spanTotal(t),spans_ms:t.spans.map(p=>[p[0]-at,p[1]-at])},null,at);}
 function sampleEngagement(force=false){
  const now=performance.now(),end=intentional?now:Math.min(now,lastInput+60000);
  // Event diet (2026-09-27): 60 s intervals, not 30 s — half the rows, same summed time.
  const duration=Math.floor(Math.min(60000,Math.max(0,end-lastSample)));
  if(!force&&now-lastSample<60000)return;
  const engagement=intentional?'intentional':'active';
  if(inApp&&allowed()&&wasVisible&&(intentional||wasFocused)&&duration>0){
   if(stretch&&(stretch.feature!==feature||stretch.engagement!==engagement))flushStretch();
   // Anchored at the engaged end (wall clock), so back-to-back full minutes join exactly.
   const stop=Date.now()-Math.round(now-end),start=stop-duration;
   if(stretch&&(spanTotal(stretch)+duration>300000||stretch.spans.length>=20&&start>stretch.spans.at(-1)[1]||stop-stretch.spans[0][0]>1800000))flushStretch();
   stretch??={feature,engagement,spans:[]};const last=stretch.spans.at(-1);
   if(last&&start<=last[1])last[1]+=duration;else stretch.spans.push([start,stop]);
   if(spanTotal(stretch)>=300000)flushStretch();
  }else if(!(inApp&&allowed()&&wasVisible&&(intentional||wasFocused))||stretch&&Date.now()-stretch.spans.at(-1)[1]>300000)flushStretch();
  // (an idle-but-visible minute keeps the stretch open: its spans record the gap exactly)
  lastSample=now;wasVisible=!document.hidden;wasFocused=typeof document.hasFocus!=='function'||document.hasFocus();
 }
 function activity(next,passive=false){
  if(!features.has(next))return;sampleEngagement(true);if(next!==feature)flushStretch();
  // feature.exited dropped (event diet phase 1, 2026-09-27): no report reads it.
  if(next!==feature){feature=next;event('feature.entered',{feature},null);}
  intentional=!!passive&&['call','focusTimer','lofiStudy'].includes(next);
 }
 const input=()=>{sampleEngagement(performance.now()-lastInput>60000);lastInput=performance.now();};
 // No input values or key codes are inspected or stored.
 for(const type of ['pointerdown','keydown','wheel','touchstart'])document.addEventListener(type,input,{passive:true});
 window.addEventListener('focus',()=>sampleEngagement(true));window.addEventListener('blur',()=>sampleEngagement(true));
 document.addEventListener('visibilitychange',()=>{sampleEngagement(true);if(document.hidden)flushStretch();for(const attempt of startupAttempts)attempt.visibility();snapshotReadiness();});
 window.addEventListener('pagehide',()=>{sampleEngagement(true);flushStretch();});window.addEventListener('pageshow',()=>{lastSample=performance.now();wasVisible=!document.hidden;wasFocused=typeof document.hasFocus!=='function'||document.hasFocus();});
 setInterval(sampleEngagement,15000);
 function cancelBinding(){bindingController?.abort();bindingController=null;if(bindingTimer)clearTimeout(bindingTimer);bindingTimer=null;bindingWork=null;bindingNeeded=false;bindingAttempts=0;bindingDone=null;}
 async function resumeIdentity(){
  const identity=confirmedIdentity;if(!allowed()||!identity||identity.generation!==authGeneration||identity.auth!==latestAuth)return;
  await acceptSession(identity.measurementSession||{account:{uid:identity.uid}},identity.auth,null,identity.generation);
 }
 // Independent of business fetches. Only an opaque retry intent is durable;
 // the current authenticated session must supply its own fresh bearer on reload.
 function refreshBinding(){
  if(bindingWork||bindingTimer||!bindingNeeded||bindingAttempts>=3||!allowed()||!confirmedIdentity||confirmedIdentity.generation!==authGeneration||token!==latestAuth||!accountScope||state.accountScope!==accountScope)return;
  const identity=confirmedIdentity,id=state.visitor,revision=state.revision,generation=authGeneration,scope=accountScope;
  const current=()=>allowed()&&state.visitor===id&&state.revision===revision&&authGeneration===generation&&token===identity.auth&&accountScope===scope;
  bindingAttempts++;
  const work=Promise.resolve().then(async()=>{
   await flush(true,true);if(!current()||!membershipReady())return false;
   const abort=new AbortController();bindingController=abort;const timeout=setTimeout(()=>abort.abort(),15000);
   try{
    const response=await nativeFetch('/api/session',{method:'GET',headers:{authorization:identity.auth,'x-ny-measurement':id,'x-ny-feature':feature},cache:'no-store',signal:abort.signal});
    if(!response.ok||!current())return false;
    const value=await response.json();if(!current()||value?.account?.uid!==identity.uid)return false;
    await acceptSession(value,identity.auth,id,generation);if(!current())return false;
    bindingNeeded=false;bindingDone=id+':'+revision+':'+scope;removeRecord('binding-'+id);return true;
   }finally{clearTimeout(timeout);if(bindingController===abort)bindingController=null;}
  }).catch(()=>false).finally(()=>{
   if(bindingWork!==work)return;
   bindingWork=null;
   if(current()&&bindingNeeded&&bindingAttempts<3&&!bindingTimer)bindingTimer=setTimeout(()=>{bindingTimer=null;void refreshBinding();},4000*2**(bindingAttempts-1));
  });
  bindingWork=work;return work;
 }
 async function acceptSession(s,auth,expectedVisitor=state.visitor,generation=authGeneration,notifyVendor=true){
  await handoffReady;
  if(generation!==authGeneration||auth!==latestAuth)return;
  const uid=s?.account?.uid;
  if(typeof uid!=='string'||!uid.length||uid.length>128||uid.trim()!==uid||/[\u0000-\u001f\u007f]/.test(uid)){if(notifyVendor)vendor('session',s,auth,nativeFetch);return;}
  token=auth;
  const measurementSession=s?.profile||s?.measurement||s?.entitlement?{
   account:{uid},
   ...(s.profile?.birthday?{profile:{birthday:s.profile.birthday}}:{}),
   ...(s.measurement?{measurement:{signupReceipt:s.measurement.signupReceipt,registrationReceipt:s.measurement.registrationReceipt,advertisingMatch:s.measurement.advertisingMatch,capReceipt:s.measurement.capReceipt,excluded:s.measurement.excluded}}:{}),
   ...(s.entitlement?.sources?{entitlement:{sources:s.entitlement.sources}}:{}),
  }:confirmedIdentity?.uid===uid?confirmedIdentity.measurementSession:null;
  confirmedIdentity={uid,auth,generation,measurementSession};
  if(!allowed()){if(notifyVendor)vendor('session',s,auth,nativeFetch);return;}
  const id=visitor(),revision=state.revision;
  {
   const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(id+':'+uid));
   if(generation!==authGeneration||auth!==latestAuth||!allowed()||revision!==state.revision||id!==state.visitor)return;
   const scope=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
   if(state.accountScope&&state.accountScope!==scope){window.__nyMeasurement.resetAccount();latestAuth=auth;return acceptSession(s,auth,null,authGeneration,notifyVendor);}
   accountScope=scope;state.accountScope=scope;save();
  }
  restore();
  enableAutomaticAds(s);
  const r=s?.measurement?.signupReceipt;
  if(allowed()&&expectedVisitor===state.visitor&&r&&Number.isSafeInteger(r.at)&&r.expires>Date.now()&&r.expires<=Date.now()+DAY&&/^[a-f0-9]{64}$/.test(r.signature||'')&&[null,'qa','tester','permanent_premium'].includes(r.cohort)){
   pendingSignup={at:r.at,expires:r.expires,signature:r.signature,cohort:r.cohort};
   if(accountScope)persist('signup-'+state.visitor,{signup:pendingSignup});
  }
  if(notifyVendor)vendor('session',s,auth,nativeFetch);
  // Missing headers OR unacknowledged membership at dispatch need a bounded
  // signed-receipt refresh with the now-confirmed owner and consent membership.
  if(expectedVisitor!==state.visitor&&bindingDone!==id+':'+revision+':'+accountScope){bindingNeeded=true;persist('binding-'+id,{binding:1});}
  void flush(true);void refreshBinding();
 }
 async function handoffRequest(action,extra={}){
  await policyReady;
  if(!adsAllowed()||state.accountScope&&accountScope!==state.accountScope)return null;
  if(!await ensureMembership())return null;
  const generation=authGeneration,revision=state.revision,handoffVisitor=state.visitor;
  const response=await nativeFetch('/api/browser-handoff',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,visitor:visitor(),consent:true,marketing:true,basis:state.basis,...extra}),signal:AbortSignal.timeout(3000)});
  if(!response.ok||!adsAllowed()||(action!=='redeem'&&generation!==authGeneration)||revision!==state.revision||handoffVisitor!==state.visitor)return null;
  return response.json();
 }
 // Event diet phase switch: true = per-piece voice events still sent (P1
 // parity window); false = per-turn voice.turn_summary only (P2).
 window.__nyMeasurement={event,activity,settings,adClickParams,startup,currentTrace:()=>activeTrace,
  prepareHandoff:()=>handoffRequest('create'),
  authenticate(uid,auth){
   if(confirmedIdentity?.uid===uid&&confirmedIdentity.auth===auth&&token===auth)return Promise.resolve();
   if(latestAuth!==auth){latestAuth=auth;token=null;authGeneration++;controller?.abort();confirmedIdentity=null;cancelBinding();}
   return acceptSession({account:{uid}},auth,null,authGeneration,false);
  },
  session(s,auth){if(latestAuth!==auth){latestAuth=auth;token=null;authGeneration++;controller?.abort();confirmedIdentity=null;cancelBinding();}return acceptSession(s,auth);},
  headers:()=>state.accountScope&&accountScope!==state.accountScope?{}:visitor()?{'x-ny-measurement':visitor()}:{},
  // A user Retry is another invocation of the SAME logical turn, not a new
  // submit. Tickets fence duplicate/stale callbacks and account resets; no
  // timer/request, product retry or paid/free admission behavior is added.
  begin(trace,retry=false){const prior=traceClocks.get(trace);if(prior&&!retry||retry&&!prior)return false;
   const clock={kind:'turn-invocation-v1',at:performance.now(),ended:false,attempt:prior?prior.attempt+1:1,root:prior?prior.root:{}};
   activeTrace=trace;traceClocks.set(trace,clock);if(traceClocks.size>128)traceClocks.delete(traceClocks.keys().next().value);
   if(!prior)event('conversation.submit',{},trace);return clock;},
  end(trace,ok,outcome,reason,detail,httpStatus,timing,invocation){const current=traceClocks.get(trace),clock=invocation===undefined?current:invocation;
   if(!current||!clock||clock.root!==current.root||clock.ended||invocation===undefined&&current.attempt>1)return;clock.ended=true;
   const cancelled=outcome==='cancelled',success=outcome==='completed'||(!outcome&&ok);
   // 9 Oct (rel43, worker 6c7d5b11): the sign-in token step before the send (a hung refresh held a payer's message 21 s) and,
   // on a cancel, whether it came while waiting for text or while she was speaking.
   const t=timing&&typeof timing==='object'?timing:{},tm={...(Number.isInteger(t.token_ms)&&t.token_ms>=0?{token_ms:Math.min(60000,t.token_ms)}:{}),...(t.token_forced==='yes'||t.token_forced==='no'?{token_forced:t.token_forced}:{}),...(cancelled&&(t.cancel_phase==='waiting'||t.cancel_phase==='speaking'||t.cancel_phase==='after_speech')?{cancel_phase:t.cancel_phase}:{})};
   event(success?'conversation.turn_completed':'conversation.turn_failed',{...tm,duration_ms:performance.now()-clock.at,...(clock.attempt>1?{turn_attempt:clock.attempt}:{}),outcome:cancelled?'cancel':success?'success':'error',...(!success&&!cancelled&&dimensions.failure_reason.includes(reason)?{failure_reason:reason}:{}),...(!success&&!cancelled&&reason==='network'&&dimensions.network_detail?.includes(detail)?{network_detail:detail}:{}),...(!success&&!cancelled&&Number.isInteger(httpStatus)&&httpStatus>=400&&httpStatus<=599?{http_status:httpStatus}:{})},trace);if(current===clock&&activeTrace===trace)activeTrace=null;},
  resetAccount(){authGeneration++;entryActive=false;purge();lastSample=performance.now();lastInput=-Infinity;token=null;latestAuth=null;accountScope=null;confirmedIdentity=null;cancelBinding();startupAttempts.clear();queue=[];pendingTouch=null;pendingClicks={};pendingSignup=null;activeTrace=null;traceClocks.clear();controller?.abort();state.accountScope=null;state.visitor=null;state.visitorUntil=0;state.ads=null;state.touch=null;vendor('reset');save();},
  flush,ensureMembership,choose,optInRegion:()=>policyOptIn,snapshot:()=>({enabled:allowed(),marketing:adsAllowed(),advertisingScope:adsAllowed()?4:null, // ad disclosure version, unchanged by the scope-5 product rule
  advertisingBasis:adsAllowed()?state.basis:null,
   // A default is not consent. This independently permits only the bridge's
   // anonymous landing + trusted geography path. A prior refusal remains a refusal.
   applovinDefaultAllowed:navigator.globalPrivacyControl!==true&&!(state.basis!=='automatic'&&state.revision>0&&!state.marketing),queued:queue.length,health:{...health}})};
 // No IDs, events or ad consent in this policy request. An explicit refusal,
 // GPC, unknown geography or a consent-required region never auto-enables.
 let policyRetry=0,policyTimer=null,policyPending=null,policyOptIn=null;
 function recover(){retryCount=0;void requestPolicy().then(()=>{if(allowed()){restore();pendingTouch??=retainTouch();snapshotReadiness();void resumeIdentity();void flush();}});}
 function requestPolicy(){if(policyPending)return policyPending;policyPending=loadPolicy().finally(()=>{policyPending=null;});return policyPending;}
 async function loadPolicy(){if(automaticApproved||navigator.globalPrivacyControl===true||state.revision>0&&!state.consent||state.consent&&state.basis!=='automatic')return;
  const initialRevision=state.revision;
  try{const deadline=new AbortController(),timeout=setTimeout(()=>deadline.abort(),1500);let policy;try{const r=await nativeFetch('/api/measurement?policy=1',{signal:deadline.signal,credentials:'same-origin'});if(!r.ok)throw Error('policy_unavailable');policy=await r.json();policyVerified=true;policyOptIn=typeof policy.optInRegion==='boolean'?policy.optInRegion:null;policyEu=policy.euRegion===true;}finally{clearTimeout(timeout);}
    // An EU/EEA visitor whose saved choice is already 'Essential only' (incl. answers given before 9 Oct) goes memory-only.
    if(policyEu&&!volatile&&state.basis==='choice'&&state.consent===false)memoryOnly(true);
   if(policy.automaticAdvertising!==true)return;
   if(state.revision!==initialRevision||state.revision>0&&!state.consent)return;
   automaticApproved=true;
   const same=state.revision>0&&state.basis==='automatic'&&state.consent===true&&state.marketing===true;
   state={...state,scope:5,basis:'automatic',consent:true,marketing:policy.automaticAdvertising===true,revision:!state.revision?Date.now():same?state.revision:Math.max(Date.now(),state.revision+1),expires:Date.now()+90*DAY};save();
   snapshotReadiness();void resumeIdentity();
  }catch{if(policyRetry++<3&&!policyTimer)policyTimer=setTimeout(()=>{policyTimer=null;recover();},4000*policyRetry);}
 }
 const policyReady=requestPolicy();
 // Only our application transports receive the correlation header, never providers.
 window.fetch=async(input,init)=>{
  let url;try{url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);}catch{return nativeFetch(input,init);}
  if(url.origin!==location.origin||!/^\/api\/(session|chat|tts|asr|stripe\/checkout)(\/|$)/.test(url.pathname))return nativeFetch(input,init);
  const headers=new Headers(init?.headers||((input instanceof Request)?input.headers:undefined)),auth=headers.get('authorization');
  if(url.pathname==='/api/session'&&auth&&auth!==latestAuth){latestAuth=auth;token=null;authGeneration++;controller?.abort();confirmedIdentity=null;cancelBinding();}
  const generation=authGeneration;
  const id=state.accountScope&&(!token||token!==auth)?null:visitor();
  // A call run's own trace rides on its transcription requests (joins the ASR receipt).
  const callerTrace=url.pathname==='/api/asr'?headers.get('x-ny-trace'):null;
  headers.delete('x-ny-measurement');headers.delete('x-ny-feature');headers.delete('x-ny-trace');if(id)headers.set('x-ny-measurement',id);
  if(id)headers.set('x-ny-feature',feature);
  // voice.requested dropped (event diet phase 1): no reader; trace header kept.
  if(id&&activeTrace&&url.pathname==='/api/tts')headers.set('x-ny-trace',activeTrace);
  if(id&&callerTrace&&uuidPattern.test(callerTrace))headers.set('x-ny-trace',callerTrace);
  // Only attach identifiers while their consent and account scope remain current.
  if(!allowed()||id!==state.visitor||generation!==authGeneration){headers.delete('x-ny-measurement');headers.delete('x-ny-feature');headers.delete('x-ny-trace');}
  const boundVisitor=id&&membershipReady()?id:null;
  const request=nativeFetch(input,{...init,headers});
  // Dispatch the user request FIRST. Tracking membership and its bounded wait
  // run independently; server telemetry tolerates this initial membership race.
  if(id&&['/api/session','/api/chat','/api/tts','/api/asr'].includes(url.pathname))void ensureMembership().catch(()=>{});
  const response=await request;
  if(url.pathname==='/api/stripe/checkout'&&response.ok){
   void response.clone().json().then(body=>{
    if(generation!==authGeneration)return;
    const checkoutRequest=JSON.parse(init?.body||'{}');
    if(checkoutRequest.prepare===true)return;
    window.__nyAdPixels?.checkout(checkoutRequest.plan,body.checkoutEventId);
   }).catch(()=>{});
  }
  if(url.pathname==='/api/session'&&response.ok&&auth){void response.clone().json().then(s=>acceptSession(s,auth,boundVisitor,generation)).catch(()=>{});}
  return response;
 };
 // Codex rel42 NF3: another tab switching memory-only on/off (EU Essential / Allow) applies here too, in the order the
 // other tab wrote it (flag first, then the state key), so this tab neither recreates storage nor stays volatile.
 window.addEventListener('storage',e=>{if(e.key===MEMORY_ONLY){const on=e.newValue==='1';if(on&&!volatile){volatile=true;purge();}else if(!on&&volatile){volatile=false;save();}return;}});
 window.addEventListener('storage',e=>{if(e.key===KEY||e.key===null){const next=read(),changed=next.revision!==state.revision||next.visitor!==state.visitor||next.accountScope!==state.accountScope;if(next.visitor!==state.visitor)entryActive=false;state=next;if(changed){authGeneration++;queue=[];pendingTouch=null;pendingTouchKey=null;pendingClicks={};pendingSignup=null;controller?.abort();token=null;latestAuth=null;accountScope=null;confirmedIdentity=null;cancelBinding();startupAttempts.clear();lastSample=performance.now();lastInput=-Infinity;}if(!allowed()){purge();vendor('stop');}else{if(!adsAllowed())vendor('stop');restore();snapshotReadiness();}}});
 window.addEventListener('online',recover);window.addEventListener('pageshow',recover);
 window.addEventListener('ny:signed-out',()=>window.__nyMeasurement.resetAccount());
 window.addEventListener('pagehide',()=>void flush());document.addEventListener('visibilitychange',()=>{if(document.hidden)void flush();});
 // T22 (4 Oct): the app's resolved language (set on <html> before first render)
 // and a coarse timezone bucket. Product telemetry; the raw zone is never sent.
 const US=new Set(['New_York','Chicago','Denver','Los_Angeles','Phoenix','Anchorage','Detroit','Boise','Juneau','Sitka','Nome','Adak','Yakutat','Metlakatla','Menominee']);
 const TZ={'Asia/Shanghai':'cn','Asia/Chongqing':'cn','Asia/Harbin':'cn','Asia/Urumqi':'cn','Asia/Kashgar':'cn','Asia/Hong_Kong':'hk','Asia/Macau':'mo','Asia/Taipei':'tw',
  'Asia/Singapore':'sg','Asia/Kuala_Lumpur':'my','Asia/Kuching':'my','Asia/Tokyo':'jp','Asia/Seoul':'kr','Asia/Manila':'ph','Asia/Jakarta':'id','Asia/Makassar':'id',
  'Asia/Jayapura':'id','Asia/Bangkok':'th','Asia/Ho_Chi_Minh':'vn','Asia/Saigon':'vn','Asia/Kolkata':'in','Asia/Calcutta':'in','Pacific/Honolulu':'us'};
 function tzBucket(zone){
  if(TZ[zone])return TZ[zone];const [area,...rest]=String(zone).split('/'),place=rest.join('/');
  if(area==='America')return US.has(place)||/^(Indiana|Kentucky|North_Dakota)\//.test(place)?'us':'other_americas';
  return area==='Europe'?'europe':area==='Africa'?'africa':area==='Australia'||area==='Pacific'?'oceania':area==='Asia'?'other_asia':'other';
 }
 function appContext(){
  const out={};
  try{const lang=document.documentElement.lang;if(dimensions.locale?.includes(lang))out.locale=lang;}catch{}
  try{const bucket=tzBucket(Intl.DateTimeFormat().resolvedOptions().timeZone||'');if(dimensions.tz_bucket?.includes(bucket))out.tz_bucket=bucket;}catch{}
  return out;
 }

 // Consent bar (owner 2 Oct spec, shipped 7 Oct): opt-in-law regions only (EU/EEA, UK, CH, Quebec, from the
 // gateway's optInRegion), never under GPC or when the region read fails. Non-blocking, top edge (never over
 // Get Started); no answer = no consent; equal "Essential only" / "Allow" wired to choose(). Asks again once,
 // >=183 days after "Essential only", and when an "Allow" has lapsed. A Settings choice counts as an answer.
 const BAR_KEY='ny.consentBar.v1';
 async function consentBar(){
  if(navigator.globalPrivacyControl===true||document.getElementById('ny-consent-bar'))return;
  let seen=null;try{seen=JSON.parse(localStorage.getItem(BAR_KEY)||'null');}catch{}
  const now=Date.now();
  if(seen?.answer==='allow'&&!(state.consent&&state.expires<=now))return;
  if(seen?.answer==='essential'&&(seen.reasked||now-seen.at<183*DAY))return;
  if(!seen&&state.basis==='choice'&&!(state.consent&&state.expires<=now))return;
  let opt=policyOptIn;
  if(opt===null){try{const c=new AbortController(),t=setTimeout(()=>c.abort(),1500);try{const r=await nativeFetch('/api/measurement?policy=1',{signal:c.signal,credentials:'same-origin'});if(r.ok){const p=await r.json();if(typeof p.optInRegion==='boolean')opt=policyOptIn=p.optInRegion;policyEu=p.euRegion===true;}}finally{clearTimeout(t);}}catch{}}
  if(opt!==true||document.getElementById('ny-consent-bar'))return;
  const bar=document.createElement('section');bar.id='ny-consent-bar';bar.setAttribute('role','region');bar.setAttribute('aria-label','Cookie choices');
  bar.style.cssText='position:fixed;z-index:999999;left:50%;top:calc(8px + env(safe-area-inset-top));transform:translateX(-50%);box-sizing:border-box;width:min(520px,calc(100% - 16px));display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:center;background:#fffaf4;color:#443c3b;border:1px solid #e5d8c8;border-radius:14px;padding:10px 12px;box-shadow:0 4px 18px #382b3722;font:13px/1.35 system-ui,sans-serif';
  bar.innerHTML='<p style="grid-column:1/-1;margin:0">We use cookies for essential site functions and advertising. <a href="/data-usage" target="_blank" rel="noopener" style="color:inherit">Learn more</a></p><button type="button" data-bar="essential">Essential only</button><button type="button" data-bar="allow">Allow</button>';
  for(const b of bar.querySelectorAll('button'))b.style.cssText='width:100%;min-height:40px;border:1px solid #d9c9b8;border-radius:10px;background:#fff;color:#443c3b;font:600 14px system-ui,sans-serif;padding:0 8px;cursor:pointer';
  const answer=a=>{try{localStorage.setItem(BAR_KEY,JSON.stringify({answer:a,at:Date.now(),reasked:!!seen}));}catch{}bar.remove();void choose(a==='allow',a==='allow');};
  bar.querySelector('[data-bar="essential"]').onclick=()=>answer('essential');bar.querySelector('[data-bar="allow"]').onclick=()=>answer('allow');
  document.body.append(bar);
 }
 async function boot(){
  vendor('start'); void checkEuRefusal(); // Landing measurement must not wait for Firebase or policy fetch.
  const root=document.getElementById('root');if(root&&typeof MutationObserver!=='undefined'){
   const ready=()=>{if(!root.firstElementChild)return false;event('experience.app_ready',allowed()?{duration_ms:performance.now(),...appContext()}:{},null);return true;};
   if(!ready()){const observer=new MutationObserver(()=>{if(ready())observer.disconnect();});observer.observe(root,{childList:true});}
  }
  await policyReady;
  const handoff=window.__nyHandoffToken;window.__nyHandoffToken=null;
  if(handoff&&adsAllowed()&&!state.accountScope){
   try{const imported=await handoffRequest('redeem',{token:handoff});
    if(imported&&!state.accountScope){
     // Retain the original click time, not the browser-switch time. A fresh
     // explicit destination campaign always takes precedence.
     if(safeTouch(imported.touch)&&!touch()){state.touch=imported.touch;pendingTouch=imported.touch;entryActive=false;}
     if(!Object.keys(clicks()).length&&safeClicks(imported.clicks)&&imported.clicksUntil>Date.now()){
      const kept=currentClicks(imported.clicks);state.ads={values:kept,until:Math.min(imported.clicksUntil,Date.now()+30*DAY)};pendingClicks=kept;
     }
     save();event('auth.escape_redeemed',{auth_browser:'mobile'});
    }
   }catch{/* Attribution loss must never block access. */}
  }
  finishHandoff?.();finishHandoff=null;
  // No floating chrome over the avatar, onboarding or checkout. The existing
  // Settings/footer Privacy Policy link leads to this explicit control.
  const b=document.getElementById('ny-privacy-choices');
  if(b)b.onclick=e=>{e?.stopPropagation();settings();};
  if(b&&location.hash==='#ny-privacy-choices')settings();
  void consentBar();
  if(allowed()){visitor();restore();pendingTouch=retainTouch();if(!pendingTouch)pendingClicks=clicks();retainClicks();save();vendor('start');event('acquisition.landing_observed',{path:location.pathname.startsWith('/app')?'app':'landing'},null);bootWatch();
   const checkout=entry.get('checkout');if(['success','cancel'].includes(checkout))checkoutReturned(checkout);
  }
  // Global Privacy Control opts out of advertising sale/sharing only.
  if(navigator.globalPrivacyControl===true&&state.consent)void choose(false,false);
  // Do not cover the first
  // Get Started action with an unsolicited optional-consent sheet.
  snapshotReadiness();void resumeIdentity();
  window.__nyPrepareBrowserHandoff?.();
 }
 // Preserve only consented campaign identifiers for same-origin app links.
 document.addEventListener('click',e=>{if(!adsAllowed())return;const a=e.target?.closest?.('a[href]');if(!a)return;try{const u=new URL(a.href,location.href);if(u.origin!==location.origin||!u.pathname.startsWith('/app'))return;for(const [k,v]of Object.entries(adClickParams()))u.searchParams.set(k,v);a.href=u.href;}catch{}},true);
 // Boot watchdog: the legacy event name includes pre-boot hide observations.
 // Existing fields distinguish them: hidden + concrete stage = hide/pagehide;
 // hidden + stage 'hidden' = deadline while hidden; visible = deadline visible.
 // A hide is not a timeout or proof of a bounce. Preserve it independently of
 // the 15 s wall-clock deadline and a later visible observation after return.
 // Payer behavior: diagnostics only, never gates or retries app/auth startup.
 function bootWatch(){
  if(!inApp||bootWatched)return;bootWatched=true;
  const t0=performance.now();let entryDone=!window.__nyBrowserEntry;
  try{window.__nyBrowserEntry?.then?.(()=>{entryDone=true;},()=>{entryDone=true;});}catch{entryDone=true;}
  let earlyReported=false,hiddenReported=false,visibleReported=false,lastRecord=null;
  const where=()=>{const main=(performance.getEntriesByType?.('resource')||[]).some(e=>/\/app\/assets\/main-[\w-]+\.js$/.test(e.name)&&e.responseEnd>0);
   return document.getElementById('ny-browser-door')?'door':!entryDone?'entry_waiting':!main?'bundle_import':'app_init';};
  const beacon=()=>{try{
   // Only this watch's current unacknowledged record. Never a restored older
   // page's row, and never re-send a row already acknowledged or evicted.
   const rec=lastRecord&&queue.find(e=>e.id===lastRecord.id);
   if(rec&&state.visitor&&allowed()&&navigator.sendBeacon)navigator.sendBeacon('/api/measurement',new Blob([JSON.stringify({visitor:state.visitor,consent:allowed(),marketing:membershipMarketing(),marketingBasis:state.basis||null,revision:state.revision,attribution:null,clicks:{},events:[rec]})],{type:'application/json'}));
  }catch{}};
  const report=(stage,visibility,unloading=false)=>{
   if(event('experience.boot_timeout',{boot_stage:stage,visibility,duration_ms:Math.round(performance.now()-t0)},null))lastRecord=queue[queue.length-1];
   if(unloading)beacon();else void flush(true);
  };
  const deadline=()=>{
   if(bootSeen||performance.now()-t0<15000)return;
   if(document.visibilityState!=='visible'){
    if(!hiddenReported&&!visibleReported){hiddenReported=true;report('hidden','hidden');}
   }else if(!visibleReported){visibleReported=true;report(where(),'visible');}
  };
  bootEarly=(pagehide)=>{
   if(bootSeen)return;
   if(pagehide||document.visibilityState!=='visible'){
    if(!earlyReported&&!hiddenReported&&!visibleReported){earlyReported=true;report(where(),'hidden',pagehide);}
    else if(pagehide)beacon();
   }else deadline();
  };
  // One timer, no polling/rearm. Up to one hide row, one hidden deadline and
  // one visible deadline per page load. Foreground wake reuses the listener.
  setTimeout(()=>{try{deadline();}catch{/* diagnostics only */}},15000);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
