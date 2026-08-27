import React, { useEffect, useMemo, useState } from "react";
import ForgeReconciler, { Box, Button, Checkbox, Heading, Label, SectionMessage, Select, Spinner, Stack, Textfield, Toggle } from "@forge/react";
import { invoke } from "@forge/bridge";

const SOURCE_FIELDS = {
  recipientCompany:"Recipient company",recipientName:"Recipient contact name",recipientPhone:"Recipient phone",recipientEmail:"Recipient email",
  address1:"Address line 1",address2:"Address line 2",address3:"Address line 3",city:"City / locality",province:"State / province name",provinceCode:"State / province code",postalCode:"Postal code",countryCode:"Country code (ISO 2-letter)",
  shipmentDate:"Shipment date",packageCount:"Package count",weight:"Weight (kg)",length:"Length (cm)",width:"Width (cm)",height:"Height (cm)",contents:"Contents / description",reference:"Customer reference",declaredValue:"Declared value",currency:"Currency",incoterm:"Incoterm",exportReason:"Export reason",
  invoiceNumber:"Invoice number",invoiceDate:"Invoice date",commodityDescription:"Commodity description",commodityQuantity:"Commodity quantity",commodityUnitValue:"Commodity unit value",commodityHsCode:"HS / tariff code",commodityOriginCountry:"Country of manufacture/origin",recipientNotificationEmail:"Recipient notification email"
};
const RESPONSE_FIELDS = {shipmentId:"Shipment / dispatch ID",productCode:"DHL product/service",createdAt:"Shipment creation timestamp",estimatedDelivery:"Estimated delivery",statusSummary:"DHL warnings/status summary",pickupConfirmation:"Pickup confirmation"};
function opt(value,label=value){return {value:value||"",label:label||"— Not mapped —"}}
function Section({title,open,toggle,children}){return <Box><Button appearance="subtle" onClick={toggle}>{open?"▼":"▶"} {title}</Button>{open?<Stack space="space.200">{children}</Stack>:null}</Box>}

function App(){
 const [config,setConfig]=useState(null),[fields,setFields]=useState([]),[username,setUsername]=useState(""),[password,setPassword]=useState(""),[hasCredentials,setHasCredentials]=useState(false),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[testing,setTesting]=useState(false),[message,setMessage]=useState(null),[open,setOpen]=useState({general:true,credentials:true,shipper:false,source:false,response:false});
 useEffect(()=>{Promise.all([invoke("getShippingSettings"),invoke("getShippingJiraMetadata")]).then(([s,f])=>{setConfig(s.config);setHasCredentials(s.hasCredentials);setFields(f||[])}).catch(e=>setMessage({a:"error",t:"Could not load DHL shipment settings",b:String(e)})).finally(()=>setLoading(false))},[]);
 const fieldOptions=useMemo(()=>[{label:"— Not mapped —",value:""},...fields.map(f=>({label:`${f.name} (${f.id})`,value:f.id}))],[fields]);
 const selected=id=>id?opt(id,fields.find(f=>f.id===id)?.name||id):opt("","— Not mapped —");
 if(loading||!config)return <Spinner size="large"/>;
 const root=(k,v)=>setConfig(c=>({...c,[k]:v}));
 const map=(k,v)=>setConfig(c=>({...c,fieldMappings:{...c.fieldMappings,[k]:v}}));
 const shipper=(k,v)=>setConfig(c=>({...c,shipper:{...c.shipper,[k]:v}}));
 const response=(k,v)=>setConfig(c=>({...c,responseMappings:{...c.responseMappings,[k]:v}}));
 const save=async()=>{setSaving(true);setMessage(null);try{const r=await invoke("saveShippingSettings",{config,username,password});setHasCredentials(r.hasCredentials);setUsername("");setPassword("");setMessage({a:"confirmation",t:"Shipment settings saved",b:"The Jira shipment panel will use these mappings immediately."})}catch(e){setMessage({a:"error",t:"Could not save",b:String(e)})}finally{setSaving(false)}};
 const test=async()=>{setTesting(true);setMessage(null);try{const r=await invoke("testMyDhlCredentials");setMessage({a:r.ok?"confirmation":"error",t:r.ok?"MyDHL connection successful":"MyDHL connection failed",b:r.message})}catch(e){setMessage({a:"error",t:"MyDHL connection failed",b:String(e)})}finally{setTesting(false)}};
 return <Stack space="space.400">
  <Heading as="h1">DHL Shipment Creation — Settings</Heading>
  <SectionMessage appearance="information">Configure Jira → DHL Express shipment creation and DHL → Jira response mapping. Keep the environment on Test until end-to-end validation passes.</SectionMessage>
  {message&&<SectionMessage appearance={message.a} title={message.t}>{message.b}</SectionMessage>}

  <Section title="General" open={open.general} toggle={()=>setOpen(o=>({...o,general:!o.general}))}>
   <Toggle id="enabled" isChecked={Boolean(config.enabled)} onChange={()=>root("enabled",!config.enabled)}/><Label labelFor="enabled">Enable shipment creation</Label>
   <Label labelFor="environment">MyDHL environment</Label><Select inputId="environment" options={[{label:"Test — no live transaction",value:"test"},{label:"Production — creates real DHL shipments",value:"production"}]} value={opt(config.environment,config.environment==="production"?"Production — creates real DHL shipments":"Test — no live transaction")} onChange={s=>root("environment",s?.value||"test")}/>
   {config.environment==="production"&&<SectionMessage appearance="warning">Production creates real DHL transactions. Agents must explicitly confirm each submission.</SectionMessage>}
   <Label labelFor="projects">Allowed Jira project keys</Label><Textfield id="projects" value={(config.sourceProjects||[]).join(", ")} placeholder="HW, SD, OPS — blank means all projects" onChange={e=>root("sourceProjects",e.target.value.split(",").map(x=>x.trim()).filter(Boolean))}/>
   <Label labelFor="account">DHL Express account number</Label><Textfield id="account" value={config.accountNumber||""} onChange={e=>root("accountNumber",e.target.value)}/>
   <Label labelFor="product">Default DHL product code</Label><Textfield id="product" value={config.productCode||"P"} onChange={e=>root("productCode",e.target.value)}/>
   <Label labelFor="language">Notification language</Label><Textfield id="language" value={config.notificationLanguage||"en"} onChange={e=>root("notificationLanguage",e.target.value)}/>
   <Checkbox label="Request pickup during shipment creation" isChecked={Boolean(config.requestPickup)} onChange={()=>root("requestPickup",!config.requestPickup)}/>
   <Label labelFor="dup">Existing tracking number behaviour</Label><Select inputId="dup" options={[{label:"Block duplicate shipment creation",value:"block"},{label:"Allow re-dispatch after explicit confirmation",value:"allow"}]} value={opt(config.duplicateMode,config.duplicateMode==="allow"?"Allow re-dispatch after explicit confirmation":"Block duplicate shipment creation")} onChange={s=>root("duplicateMode",s?.value||"block")}/>
  </Section>

  <Section title="MyDHL credentials & connection" open={open.credentials} toggle={()=>setOpen(o=>({...o,credentials:!o.credentials}))}>
   <SectionMessage appearance={hasCredentials?"confirmation":"warning"}>{hasCredentials?"MyDHL username/password are stored in Forge secret storage.":"MyDHL credentials are not configured yet."}</SectionMessage>
   <Label labelFor="username">MyDHL API username</Label><Textfield id="username" value={username} placeholder={hasCredentials?"Leave blank to keep saved username":"Username"} onChange={e=>setUsername(e.target.value)}/>
   <Label labelFor="password">MyDHL API password</Label><Textfield id="password" type="password" value={password} placeholder={hasCredentials?"Leave blank to keep saved password":"Password"} onChange={e=>setPassword(e.target.value)}/>
   <Button onClick={test} isLoading={testing} isDisabled={!hasCredentials}>Test MyDHL connection</Button>
  </Section>

  <Section title="Shipper defaults" open={open.shipper} toggle={()=>setOpen(o=>({...o,shipper:!o.shipper}))}>
   <SectionMessage appearance="information">These values are used as the shipment origin.</SectionMessage>
   {[['company','Company'],['name','Contact name'],['phone','Phone'],['email','Email'],['address1','Address line 1'],['address2','Address line 2'],['address3','Address line 3'],['city','City'],['province','State / province'],['provinceCode','State / province code'],['postalCode','Postal code'],['countryCode','Country code']].map(([k,l])=><Box key={k}><Label labelFor={`ship-${k}`}>{l}</Label><Textfield id={`ship-${k}`} value={config.shipper?.[k]||""} onChange={e=>shipper(k,e.target.value)}/></Box>)}
  </Section>

  <Section title="Jira → DHL field mappings" open={open.source} toggle={()=>setOpen(o=>({...o,source:!o.source}))}>
   <SectionMessage appearance="information">Map the customer's Jira fields to DHL shipment, recipient, package, notification and customs information.</SectionMessage>
   {Object.entries(SOURCE_FIELDS).map(([k,l])=><Box key={k}><Label labelFor={`map-${k}`}>{l}</Label><Select inputId={`map-${k}`} options={fieldOptions} value={selected(config.fieldMappings?.[k])} onChange={s=>map(k,s?.value||"")}/></Box>)}
  </Section>

  <Section title="DHL → Jira response mappings" open={open.response} toggle={()=>setOpen(o=>({...o,response:!o.response}))}>
   <Label labelFor="tracking">Tracking / waybill field (required)</Label><Select inputId="tracking" options={fieldOptions} value={selected(config.trackingFieldId)} onChange={s=>root("trackingFieldId",s?.value||"")}/>
   {Object.entries(RESPONSE_FIELDS).map(([k,l])=><Box key={k}><Label labelFor={`resp-${k}`}>{l}</Label><Select inputId={`resp-${k}`} options={fieldOptions} value={selected(config.responseMappings?.[k])} onChange={s=>response(k,s?.value||"")}/></Box>)}
  </Section>

  <Button appearance="primary" onClick={save} isLoading={saving}>Save shipment settings</Button>
 </Stack>
}
ForgeReconciler.render(<React.StrictMode><App/></React.StrictMode>);
