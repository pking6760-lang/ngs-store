import{r as m,_ as y,C as T,a as D,E as Y,o as P,F as Te,g as M,v as Ie,i as ke,b as ve,c as Se,d as S}from"./index.esm2017-BZDGAVD9.js";const z="@firebase/installations",R="0.6.9";/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const X=1e4,Q=`w:${R}`,Z="FIS_v2",Ae="https://firebaseinstallations.googleapis.com/v1",Ee=60*60*1e3,_e="installations",Oe="Installations";/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Ce={"missing-app-config-values":'Missing App configuration value: "{$valueName}"',"not-registered":"Firebase Installation is not registered.","installation-not-found":"Firebase Installation not found.","request-failed":'{$requestName} request failed with error "{$serverCode} {$serverStatus}: {$serverMessage}"',"app-offline":"Could not process request. Application offline.","delete-pending-registration":"Can't delete installation while there is a pending registration request."},g=new Y(_e,Oe,Ce);function ee(e){return e instanceof Te&&e.code.includes("request-failed")}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function te({projectId:e}){return`${Ae}/projects/${e}/installations`}function ne(e){return{token:e.token,requestStatus:2,expiresIn:De(e.expiresIn),creationTime:Date.now()}}async function oe(e,t){const o=(await t.json()).error;return g.create("request-failed",{requestName:e,serverCode:o.code,serverMessage:o.message,serverStatus:o.status})}function ie({apiKey:e}){return new Headers({"Content-Type":"application/json",Accept:"application/json","x-goog-api-key":e})}function Ne(e,{refreshToken:t}){const n=ie(e);return n.append("Authorization",Pe(t)),n}async function re(e){const t=await e();return t.status>=500&&t.status<600?e():t}function De(e){return Number(e.replace("s","000"))}function Pe(e){return`${Z} ${e}`}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function Me({appConfig:e,heartbeatServiceProvider:t},{fid:n}){const o=te(e),i=ie(e),r=t.getImmediate({optional:!0});if(r){const u=await r.getHeartbeatsHeader();u&&i.append("x-firebase-client",u)}const a={fid:n,authVersion:Z,appId:e.appId,sdkVersion:Q},c={method:"POST",headers:i,body:JSON.stringify(a)},f=await re(()=>fetch(o,c));if(f.ok){const u=await f.json();return{fid:u.fid||n,registrationStatus:2,refreshToken:u.refreshToken,authToken:ne(u.authToken)}}else throw await oe("Create Installation",f)}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function ae(e){return new Promise(t=>{setTimeout(t,e)})}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Re(e){return btoa(String.fromCharCode(...e)).replace(/\+/g,"-").replace(/\//g,"_")}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const je=/^[cdef][\w-]{21}$/,N="";function Fe(){try{const e=new Uint8Array(17);(self.crypto||self.msCrypto).getRandomValues(e),e[0]=112+e[0]%16;const n=Ke(e);return je.test(n)?n:N}catch{return N}}function Ke(e){return Re(e).substr(0,22)}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function k(e){return`${e.appName}!${e.appId}`}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const se=new Map;function ce(e,t){const n=k(e);ue(n,t),$e(n,t)}function ue(e,t){const n=se.get(e);if(n)for(const o of n)o(t)}function $e(e,t){const n=qe();n&&n.postMessage({key:e,fid:t}),Le()}let l=null;function qe(){return!l&&"BroadcastChannel"in self&&(l=new BroadcastChannel("[Firebase] FID Change"),l.onmessage=e=>{ue(e.data.key,e.data.fid)}),l}function Le(){se.size===0&&l&&(l.close(),l=null)}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const xe="firebase-installations-database",Ve=1,w="firebase-installations-store";let A=null;function j(){return A||(A=P(xe,Ve,{upgrade:(e,t)=>{switch(t){case 0:e.createObjectStore(w)}}})),A}async function I(e,t){const n=k(e),i=(await j()).transaction(w,"readwrite"),r=i.objectStore(w),a=await r.get(n);return await r.put(t,n),await i.done,(!a||a.fid!==t.fid)&&ce(e,t.fid),t}async function de(e){const t=k(e),o=(await j()).transaction(w,"readwrite");await o.objectStore(w).delete(t),await o.done}async function v(e,t){const n=k(e),i=(await j()).transaction(w,"readwrite"),r=i.objectStore(w),a=await r.get(n),c=t(a);return c===void 0?await r.delete(n):await r.put(c,n),await i.done,c&&(!a||a.fid!==c.fid)&&ce(e,c.fid),c}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function F(e){let t;const n=await v(e.appConfig,o=>{const i=Be(o),r=He(e,i);return t=r.registrationPromise,r.installationEntry});return n.fid===N?{installationEntry:await t}:{installationEntry:n,registrationPromise:t}}function Be(e){const t=e||{fid:Fe(),registrationStatus:0};return fe(t)}function He(e,t){if(t.registrationStatus===0){if(!navigator.onLine){const i=Promise.reject(g.create("app-offline"));return{installationEntry:t,registrationPromise:i}}const n={fid:t.fid,registrationStatus:1,registrationTime:Date.now()},o=We(e,n);return{installationEntry:n,registrationPromise:o}}else return t.registrationStatus===1?{installationEntry:t,registrationPromise:Ue(e)}:{installationEntry:t}}async function We(e,t){try{const n=await Me(e,t);return I(e.appConfig,n)}catch(n){throw ee(n)&&n.customData.serverCode===409?await de(e.appConfig):await I(e.appConfig,{fid:t.fid,registrationStatus:0}),n}}async function Ue(e){let t=await x(e.appConfig);for(;t.registrationStatus===1;)await ae(100),t=await x(e.appConfig);if(t.registrationStatus===0){const{installationEntry:n,registrationPromise:o}=await F(e);return o||n}return t}function x(e){return v(e,t=>{if(!t)throw g.create("installation-not-found");return fe(t)})}function fe(e){return Ge(e)?{fid:e.fid,registrationStatus:0}:e}function Ge(e){return e.registrationStatus===1&&e.registrationTime+X<Date.now()}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function Je({appConfig:e,heartbeatServiceProvider:t},n){const o=Ye(e,n),i=Ne(e,n),r=t.getImmediate({optional:!0});if(r){const u=await r.getHeartbeatsHeader();u&&i.append("x-firebase-client",u)}const a={installation:{sdkVersion:Q,appId:e.appId}},c={method:"POST",headers:i,body:JSON.stringify(a)},f=await re(()=>fetch(o,c));if(f.ok){const u=await f.json();return ne(u)}else throw await oe("Generate Auth Token",f)}function Ye(e,{fid:t}){return`${te(e)}/${t}/authTokens:generate`}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function K(e,t=!1){let n;const o=await v(e.appConfig,r=>{if(!pe(r))throw g.create("not-registered");const a=r.authToken;if(!t&&Qe(a))return r;if(a.requestStatus===1)return n=ze(e,t),r;{if(!navigator.onLine)throw g.create("app-offline");const c=et(r);return n=Xe(e,c),c}});return n?await n:o.authToken}async function ze(e,t){let n=await V(e.appConfig);for(;n.authToken.requestStatus===1;)await ae(100),n=await V(e.appConfig);const o=n.authToken;return o.requestStatus===0?K(e,t):o}function V(e){return v(e,t=>{if(!pe(t))throw g.create("not-registered");const n=t.authToken;return tt(n)?Object.assign(Object.assign({},t),{authToken:{requestStatus:0}}):t})}async function Xe(e,t){try{const n=await Je(e,t),o=Object.assign(Object.assign({},t),{authToken:n});return await I(e.appConfig,o),n}catch(n){if(ee(n)&&(n.customData.serverCode===401||n.customData.serverCode===404))await de(e.appConfig);else{const o=Object.assign(Object.assign({},t),{authToken:{requestStatus:0}});await I(e.appConfig,o)}throw n}}function pe(e){return e!==void 0&&e.registrationStatus===2}function Qe(e){return e.requestStatus===2&&!Ze(e)}function Ze(e){const t=Date.now();return t<e.creationTime||e.creationTime+e.expiresIn<t+Ee}function et(e){const t={requestStatus:1,requestTime:Date.now()};return Object.assign(Object.assign({},e),{authToken:t})}function tt(e){return e.requestStatus===1&&e.requestTime+X<Date.now()}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function nt(e){const t=e,{installationEntry:n,registrationPromise:o}=await F(t);return o?o.catch(console.error):K(t).catch(console.error),n.fid}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function ot(e,t=!1){const n=e;return await it(n),(await K(n,t)).token}async function it(e){const{registrationPromise:t}=await F(e);t&&await t}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function rt(e){if(!e||!e.options)throw E("App Configuration");if(!e.name)throw E("App Name");const t=["projectId","apiKey","appId"];for(const n of t)if(!e.options[n])throw E(n);return{appName:e.name,projectId:e.options.projectId,apiKey:e.options.apiKey,appId:e.options.appId}}function E(e){return g.create("missing-app-config-values",{valueName:e})}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const le="installations",at="installations-internal",st=e=>{const t=e.getProvider("app").getImmediate(),n=rt(t),o=D(t,"heartbeat");return{app:t,appConfig:n,heartbeatServiceProvider:o,_delete:()=>Promise.resolve()}},ct=e=>{const t=e.getProvider("app").getImmediate(),n=D(t,le).getImmediate();return{getId:()=>nt(n),getToken:i=>ot(n,i)}};function ut(){y(new T(le,st,"PUBLIC")),y(new T(at,ct,"PRIVATE"))}ut();m(z,R);m(z,R,"esm2017");/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const dt="/firebase-messaging-sw.js",ft="/firebase-cloud-messaging-push-scope",ge="BDOU99-h67HcA6JeFXHbSNMu7e2yNNu3RzoMj8TM4W88jITfq7ZmPvIM1Iv-4_l2LxQcYwhqby2xGpWwzjfAnG4",pt="https://fcmregistrations.googleapis.com/v1",we="google.c.a.c_id",lt="google.c.a.c_l",gt="google.c.a.ts",wt="google.c.a.e";var B;(function(e){e[e.DATA_MESSAGE=1]="DATA_MESSAGE",e[e.DISPLAY_NOTIFICATION=3]="DISPLAY_NOTIFICATION"})(B||(B={}));/**
 * @license
 * Copyright 2018 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */var h;(function(e){e.PUSH_RECEIVED="push-received",e.NOTIFICATION_CLICKED="notification-clicked"})(h||(h={}));/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function p(e){const t=new Uint8Array(e);return btoa(String.fromCharCode(...t)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}function ht(e){const t="=".repeat((4-e.length%4)%4),n=(e+t).replace(/\-/g,"+").replace(/_/g,"/"),o=atob(n),i=new Uint8Array(o.length);for(let r=0;r<o.length;++r)i[r]=o.charCodeAt(r);return i}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const _="fcm_token_details_db",bt=5,H="fcm_token_object_Store";async function mt(e){if("databases"in indexedDB&&!(await indexedDB.databases()).map(r=>r.name).includes(_))return null;let t=null;return(await P(_,bt,{upgrade:async(o,i,r,a)=>{var c;if(i<2||!o.objectStoreNames.contains(H))return;const f=a.objectStore(H),u=await f.index("fcmSenderId").get(e);if(await f.clear(),!!u){if(i===2){const s=u;if(!s.auth||!s.p256dh||!s.endpoint)return;t={token:s.fcmToken,createTime:(c=s.createTime)!==null&&c!==void 0?c:Date.now(),subscriptionOptions:{auth:s.auth,p256dh:s.p256dh,endpoint:s.endpoint,swScope:s.swScope,vapidKey:typeof s.vapidKey=="string"?s.vapidKey:p(s.vapidKey)}}}else if(i===3){const s=u;t={token:s.fcmToken,createTime:s.createTime,subscriptionOptions:{auth:p(s.auth),p256dh:p(s.p256dh),endpoint:s.endpoint,swScope:s.swScope,vapidKey:p(s.vapidKey)}}}else if(i===4){const s=u;t={token:s.fcmToken,createTime:s.createTime,subscriptionOptions:{auth:p(s.auth),p256dh:p(s.p256dh),endpoint:s.endpoint,swScope:s.swScope,vapidKey:p(s.vapidKey)}}}}}})).close(),await S(_),await S("fcm_vapid_details_db"),await S("undefined"),yt(t)?t:null}function yt(e){if(!e||!e.subscriptionOptions)return!1;const{subscriptionOptions:t}=e;return typeof e.createTime=="number"&&e.createTime>0&&typeof e.token=="string"&&e.token.length>0&&typeof t.auth=="string"&&t.auth.length>0&&typeof t.p256dh=="string"&&t.p256dh.length>0&&typeof t.endpoint=="string"&&t.endpoint.length>0&&typeof t.swScope=="string"&&t.swScope.length>0&&typeof t.vapidKey=="string"&&t.vapidKey.length>0}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Tt="firebase-messaging-database",It=1,b="firebase-messaging-store";let O=null;function he(){return O||(O=P(Tt,It,{upgrade:(e,t)=>{switch(t){case 0:e.createObjectStore(b)}}})),O}async function kt(e){const t=be(e),o=await(await he()).transaction(b).objectStore(b).get(t);if(o)return o;{const i=await mt(e.appConfig.senderId);if(i)return await $(e,i),i}}async function $(e,t){const n=be(e),i=(await he()).transaction(b,"readwrite");return await i.objectStore(b).put(t,n),await i.done,t}function be({appConfig:e}){return e.appId}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const vt={"missing-app-config-values":'Missing App configuration value: "{$valueName}"',"only-available-in-window":"This method is available in a Window context.","only-available-in-sw":"This method is available in a service worker context.","permission-default":"The notification permission was not granted and dismissed instead.","permission-blocked":"The notification permission was not granted and blocked instead.","unsupported-browser":"This browser doesn't support the API's required to use the Firebase SDK.","indexed-db-unsupported":"This browser doesn't support indexedDb.open() (ex. Safari iFrame, Firefox Private Browsing, etc)","failed-service-worker-registration":"We are unable to register the default service worker. {$browserErrorMessage}","token-subscribe-failed":"A problem occurred while subscribing the user to FCM: {$errorInfo}","token-subscribe-no-token":"FCM returned no token when subscribing the user to push.","token-unsubscribe-failed":"A problem occurred while unsubscribing the user from FCM: {$errorInfo}","token-update-failed":"A problem occurred while updating the user from FCM: {$errorInfo}","token-update-no-token":"FCM returned no token when updating the user to push.","use-sw-after-get-token":"The useServiceWorker() method may only be called once and must be called before calling getToken() to ensure your service worker is used.","invalid-sw-registration":"The input to useServiceWorker() must be a ServiceWorkerRegistration.","invalid-bg-handler":"The input to setBackgroundMessageHandler() must be a function.","invalid-vapid-key":"The public VAPID key must be a string.","use-vapid-key-after-get-token":"The usePublicVapidKey() method may only be called once and must be called before calling getToken() to ensure your VAPID key is used."},d=new Y("messaging","Messaging",vt);/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function St(e,t){const n=await L(e),o=me(t),i={method:"POST",headers:n,body:JSON.stringify(o)};let r;try{r=await(await fetch(q(e.appConfig),i)).json()}catch(a){throw d.create("token-subscribe-failed",{errorInfo:a==null?void 0:a.toString()})}if(r.error){const a=r.error.message;throw d.create("token-subscribe-failed",{errorInfo:a})}if(!r.token)throw d.create("token-subscribe-no-token");return r.token}async function At(e,t){const n=await L(e),o=me(t.subscriptionOptions),i={method:"PATCH",headers:n,body:JSON.stringify(o)};let r;try{r=await(await fetch(`${q(e.appConfig)}/${t.token}`,i)).json()}catch(a){throw d.create("token-update-failed",{errorInfo:a==null?void 0:a.toString()})}if(r.error){const a=r.error.message;throw d.create("token-update-failed",{errorInfo:a})}if(!r.token)throw d.create("token-update-no-token");return r.token}async function Et(e,t){const o={method:"DELETE",headers:await L(e)};try{const r=await(await fetch(`${q(e.appConfig)}/${t}`,o)).json();if(r.error){const a=r.error.message;throw d.create("token-unsubscribe-failed",{errorInfo:a})}}catch(i){throw d.create("token-unsubscribe-failed",{errorInfo:i==null?void 0:i.toString()})}}function q({projectId:e}){return`${pt}/projects/${e}/registrations`}async function L({appConfig:e,installations:t}){const n=await t.getToken();return new Headers({"Content-Type":"application/json",Accept:"application/json","x-goog-api-key":e.apiKey,"x-goog-firebase-installations-auth":`FIS ${n}`})}function me({p256dh:e,auth:t,endpoint:n,vapidKey:o}){const i={web:{endpoint:n,auth:t,p256dh:e}};return o!==ge&&(i.web.applicationPubKey=o),i}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const _t=7*24*60*60*1e3;async function Ot(e){const t=await Nt(e.swRegistration,e.vapidKey),n={vapidKey:e.vapidKey,swScope:e.swRegistration.scope,endpoint:t.endpoint,auth:p(t.getKey("auth")),p256dh:p(t.getKey("p256dh"))},o=await kt(e.firebaseDependencies);if(o){if(Dt(o.subscriptionOptions,n))return Date.now()>=o.createTime+_t?Ct(e,{token:o.token,createTime:Date.now(),subscriptionOptions:n}):o.token;try{await Et(e.firebaseDependencies,o.token)}catch(i){console.warn(i)}return W(e.firebaseDependencies,n)}else return W(e.firebaseDependencies,n)}async function Ct(e,t){try{const n=await At(e.firebaseDependencies,t),o=Object.assign(Object.assign({},t),{token:n,createTime:Date.now()});return await $(e.firebaseDependencies,o),n}catch(n){throw n}}async function W(e,t){const o={token:await St(e,t),createTime:Date.now(),subscriptionOptions:t};return await $(e,o),o.token}async function Nt(e,t){const n=await e.pushManager.getSubscription();return n||e.pushManager.subscribe({userVisibleOnly:!0,applicationServerKey:ht(t)})}function Dt(e,t){const n=t.vapidKey===e.vapidKey,o=t.endpoint===e.endpoint,i=t.auth===e.auth,r=t.p256dh===e.p256dh;return n&&o&&i&&r}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function U(e){const t={from:e.from,collapseKey:e.collapse_key,messageId:e.fcmMessageId};return Pt(t,e),Mt(t,e),Rt(t,e),t}function Pt(e,t){if(!t.notification)return;e.notification={};const n=t.notification.title;n&&(e.notification.title=n);const o=t.notification.body;o&&(e.notification.body=o);const i=t.notification.image;i&&(e.notification.image=i);const r=t.notification.icon;r&&(e.notification.icon=r)}function Mt(e,t){t.data&&(e.data=t.data)}function Rt(e,t){var n,o,i,r,a;if(!t.fcmOptions&&!(!((n=t.notification)===null||n===void 0)&&n.click_action))return;e.fcmOptions={};const c=(i=(o=t.fcmOptions)===null||o===void 0?void 0:o.link)!==null&&i!==void 0?i:(r=t.notification)===null||r===void 0?void 0:r.click_action;c&&(e.fcmOptions.link=c);const f=(a=t.fcmOptions)===null||a===void 0?void 0:a.analytics_label;f&&(e.fcmOptions.analyticsLabel=f)}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function jt(e){return typeof e=="object"&&!!e&&we in e}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Ft(e){if(!e||!e.options)throw C("App Configuration Object");if(!e.name)throw C("App Name");const t=["projectId","apiKey","appId","messagingSenderId"],{options:n}=e;for(const o of t)if(!n[o])throw C(o);return{appName:e.name,projectId:n.projectId,apiKey:n.apiKey,appId:n.appId,senderId:n.messagingSenderId}}function C(e){return d.create("missing-app-config-values",{valueName:e})}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Kt{constructor(t,n,o){this.deliveryMetricsExportedToBigQueryEnabled=!1,this.onBackgroundMessageHandler=null,this.onMessageHandler=null,this.logEvents=[],this.isLogServiceStarted=!1;const i=Ft(t);this.firebaseDependencies={app:t,appConfig:i,installations:n,analyticsProvider:o}}_delete(){return Promise.resolve()}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function $t(e){try{e.swRegistration=await navigator.serviceWorker.register(dt,{scope:ft}),e.swRegistration.update().catch(()=>{})}catch(t){throw d.create("failed-service-worker-registration",{browserErrorMessage:t==null?void 0:t.message})}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function qt(e,t){if(!t&&!e.swRegistration&&await $t(e),!(!t&&e.swRegistration)){if(!(t instanceof ServiceWorkerRegistration))throw d.create("invalid-sw-registration");e.swRegistration=t}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function Lt(e,t){t?e.vapidKey=t:e.vapidKey||(e.vapidKey=ge)}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function ye(e,t){if(!navigator)throw d.create("only-available-in-window");if(Notification.permission==="default"&&await Notification.requestPermission(),Notification.permission!=="granted")throw d.create("permission-blocked");return await Lt(e,t==null?void 0:t.vapidKey),await qt(e,t==null?void 0:t.serviceWorkerRegistration),Ot(e)}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function xt(e,t,n){const o=Vt(t);(await e.firebaseDependencies.analyticsProvider.get()).logEvent(o,{message_id:n[we],message_name:n[lt],message_time:n[gt],message_device_time:Math.floor(Date.now()/1e3)})}function Vt(e){switch(e){case h.NOTIFICATION_CLICKED:return"notification_open";case h.PUSH_RECEIVED:return"notification_foreground";default:throw new Error}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function Bt(e,t){const n=t.data;if(!n.isFirebaseMessaging)return;e.onMessageHandler&&n.messageType===h.PUSH_RECEIVED&&(typeof e.onMessageHandler=="function"?e.onMessageHandler(U(n)):e.onMessageHandler.next(U(n)));const o=n.data;jt(o)&&o[wt]==="1"&&await xt(e,n.messageType,o)}const G="@firebase/messaging",J="0.12.12";/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Ht=e=>{const t=new Kt(e.getProvider("app").getImmediate(),e.getProvider("installations-internal").getImmediate(),e.getProvider("analytics-internal"));return navigator.serviceWorker.addEventListener("message",n=>Bt(t,n)),t},Wt=e=>{const t=e.getProvider("messaging").getImmediate();return{getToken:o=>ye(t,o)}};function Ut(){y(new T("messaging",Ht,"PUBLIC")),y(new T("messaging-internal",Wt,"PRIVATE")),m(G,J),m(G,J,"esm2017")}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function Gt(){try{await Ie()}catch{return!1}return typeof window<"u"&&ke()&&ve()&&"serviceWorker"in navigator&&"PushManager"in window&&"Notification"in window&&"fetch"in window&&ServiceWorkerRegistration.prototype.hasOwnProperty("showNotification")&&PushSubscription.prototype.hasOwnProperty("getKey")}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Jt(e,t){if(!navigator)throw d.create("only-available-in-window");return e.onMessageHandler=t,()=>{e.onMessageHandler=null}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function zt(e=Se()){return Gt().then(t=>{if(!t)throw d.create("unsupported-browser")},t=>{throw d.create("indexed-db-unsupported")}),D(M(e),"messaging").getImmediate()}async function Xt(e,t){return e=M(e),ye(e,t)}function Qt(e,t){return e=M(e),Jt(e,t)}Ut();export{zt as getMessaging,Xt as getToken,Gt as isSupported,Qt as onMessage};
