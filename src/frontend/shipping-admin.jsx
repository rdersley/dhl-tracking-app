import React, { useEffect, useMemo, useState } from "react";
import ForgeReconciler, { Box, Button, Checkbox, Heading, Label, SectionMessage, Select, Spinner, Stack, Textfield, Toggle } from "@forge/react";
import { invoke } from "@forge/bridge";

const SOURCE_FIELDS = {
  recipientCompany:"Recipient company",recipientName:"Recipient contact name",recipientPhone:"Recipient phone",recipientEmail:"Recipient email",
  address1:"Address line 1",address2:"Address line 2",address3:"Address line 3",city:"City / locality",province:"State / province name",provinceCode:"State / province code",postalCode:"Postal code",countryCode:"Country code (ISO 2-letter)",
  shipmentDate:"Shipment date",packageCount:"Package count",weight:"Weight (kg)",length:"Length (cm)",width:"Width (cm)",height:"Height (cm)",contents:"Contents / description",reference:"Customer reference",declaredValue:"Declared value",currency:"Currency",incoterm:"Incoterm",exportReason:"Export reason"
};
const RESPONSE_FIELDS = {shipmentId:"Shipment ID",productCode:"DHL product/service",createdAt:"Shipment creation timestamp",estimatedDelivery:"Estimated delivery",statusSummary:"DHL warnings/status summary"};
function opt(value,label=value){return value?{value,label}:null}

function App(){
 const [config,setConfig]=useState(null),[fields,setFields]=useState([]),[username,setUsername]=useState(""),[password,setPassword]=useState(""),[hasCredentials,setHasCredentials]=useState(false),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[message,setMessage]=useState(null);
 useEffect(()=>{Promise.all([invoke("getShippingSettings"),invoke("getShippingJiraMetadata")]).then(([s,f])=>{setConfig(s.config);setHasCredentials(s.hasCredentials);setFields(f||[])}).catch(e=>setMessage({a:"error",t:"Could not load DHL shipment settings",b:String(e)})).finally(()=>setLoading(false))},[]);
 const fieldOptions=useMemo(()=>[{label:"— Not mapped —",value:""},...fields.map(f=>({label:`${f.name} (${f.id})`,value:f.id}))],[fields]);
 const selected=id=>id?opt(id,fields.find(f=>f.id===id)?.name||id):opt("","— Not mapped —");
 if(loading||!config)return <Spinner size="large"/>;
 const root=(k,v)=>setConfig(c=>({...c,[k]:v}));
 const map=(k,v)=>setConfig(c=>({...c,fieldMappings:{...c.fieldMappings,[k]:v}}));
 const shipper=(k,v)=>setConfig(c=>({...c,shipper:{...c.shipper,[k]:v}}));
 const response=(k,v)=>setConfig(c=>({...c,responseMappings:{...c.responseMappings,[k]:v}}));
 const save=async()=>{setSaving(true);setMessage(null);try{const r=await invoke("saveShippingSettings",{config,username,password});setHasCredentials(r.hasCredentials);setUsername("");setPassword("");setMessage({a:"confirmation",t:"Shipment settings saved",b:"The Jira shipment panel will use these mappings immediately."})}catch(e){setMessage({a:"error",t:"Could not save",b:String(e)})}finally{setSaving(false)}};
 return <Stack space="space.400">
  <Heading as="h1">DHL Shipment Creation — Settings</Heading>
  <SectionMessage appearance="information">Configure how Jira issues become DHL Express shipments. Keep this in Test until end-to-end validation passes.</SectionMessage>
  {message&&<SectionMessage appearance={message.a} title={message.t}>{message.b}</SectionMessage>}
  <Heading as="h2">General</Heading>
  <Toggle id="enabled" isChecked={Boolean(config.enabled)} onChange={()=>root("enabled",!config.enabled)}/><Label labelFor="enabled">Enable shipment creation</Label>
  <Label labelFor="environment">MyDHL environment</Label><Select inputId="environment" options={[{label:"Test — no live transaction",value:"test"},{label:"Production — creates real DHL shipments",value:"production"}]} value={opt(config.environment,config.environment==="production"?"Production — creates real DHL shipments":"Test — no live transaction")} onChange={s=>root("environment",s?.value||"test")}/>
  {config.environment==="production"&&<SectionMessage appearance="warning">Production mode creates real DHL transactions. Agents will still receive an explicit confirmation warning before submission.</SectionMessage>}
  <Label labelFor="projects">Allowed Jira project keys</Label><Textfield id="projects" value={(config.sourceProjects||[]).join(", ")} placeholder="e.g. HW, SD, OPS (blank = all projects)" onChange={e=>root("sourceProjects",e.target.value.split(",").map(x=>x.trim()).filter(Boolean))}/>
  <Label labelFor="account">DHL Express account number</Label><Textfield id="account" value={config.accountNumber||""} onChange={e=>root("accountNumber",e.target.value)}/>
  <Label labelFor="product">Default DHL product code</Label><Textfield id="product" value={config.productCode||"P"} onChange={e=>root("productCode",e.target.value)}/>
  <Checkbox label="Request pickup during shipment creation" isChecked={Boolean(config.requestPickup)} onChange={()=>root("requestPickup",!config.requestPickup)}/>
  <Label labelFor="dup">Existing tracking number behaviour</Label><Select inputId="dup" options={[{label:"Block duplicate shipment creation",value:"block"},{label:"Allow re-dispatch after agent confirmation",value:"allow"}]} value={opt(config.duplicateMode,config.duplicateMode==="allow"?"Allow re-dispatch after agent confirmation":"Block duplicate shipment creation")} onChange={s=>root("duplicateMode",s?.value||"block")}/>

  <Heading as="h2">MyDHL credentials</Heading>
  <SectionMessage appearance={hasCredentials?"confirmation":"warning"}>{hasCredentials?"MyDHL username/password are securely stored in Forge secret storage.":"MyDHL credentials are not configured yet."}</SectionMessage>
  <Label labelFor="username">MyDHL API username</Label><Textfield id="username" value={username} placeholder={hasCredentials?"Leave blank to keep saved username":"Username"} onChange={e=>setUsername(e.target.value)}/>
  <Label labelFor="password">MyDHL API password</Label><Textfield id="password" type="password" value={password} placeholder={hasCredentials?"Leave blank to keep saved password":"Password"} onChange={e=>setPassword(e.target.value)}/>

  <Heading as="h2">Shipper defaults</Heading>
  <SectionMessage appearance="information">These values are used as the shipping origin. Jira-field overrides can be added later without changing the shipment engine.</SectionMessage>
  {[['company','Company'],['name','Contact name'],['phone','Phone'],['email','Email'],['address1','Address line 1'],['address2','Address line 2'],['address3','Address line 3'],['city','City'],['province','State / province'],['provinceCode','State / province code'],['postalCode','Postal code'],['countryCode','Country code']].map(([k,l])=><Box key={k}><Label labelFor={`ship-${k}`}>{l}</Label><Textfield id={`ship-${k}`} value={config.shipper?.[k]||""} onChange={e=>shipper(k,e.target.value)}/></Box>)}

  <Heading as="h2">Jira → DHL field mappings</Heading>
  <SectionMessage appearance="information">Nothing is hard-coded to a customer Jira instance. Map each DHL value to the field used by this site.</SectionMessage>
  {Object.entries(SOURCE_FIELDS).map(([k,l])=><Box key={k}><Label labelFor={`map-${k}`}>{l}</Label><Select inputId={`map-${k}`} options={fieldOptions} value={selected(config.fieldMappings?.[k])} onChange={s=>map(k,s?.value||"")}/></Box>)}

  <Heading as="h2">DHL → Jira response mappings</Heading>
  <Label labelFor="tracking">Tracking / waybill field (required)</Label><Select inputId="tracking" options={fieldOptions} value={selected(config.trackingFieldId)} onChange={s=>root("trackingFieldId",s?.value||"")}/>
  {Object.entries(RESPONSE_FIELDS).map(([k,l])=><Box key={k}><Label labelFor={`resp-${k}`}>{l}</Label><Select inputId={`resp-${k}`} options={fieldOptions} value={selected(config.responseMappings?.[k])} onChange={s=>response(k,s?.value||"")}/></Box>)}

  <Button appearance="primary" onClick={save} isLoading={saving}>Save shipment settings</Button>
 </Stack>
}
ForgeReconciler.render(<React.StrictMode><App/></React.StrictMode>);
