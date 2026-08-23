import React, { useEffect, useState } from "react";
import ForgeReconciler, { Box, Button, Checkbox, Heading, SectionMessage, Spinner, Stack, Text, useProductContext } from "@forge/react";
import { invoke } from "@forge/bridge";

function Row({label,value}){return <Box><Text><Text as="strong">{label}: </Text>{value||"—"}</Text></Box>}

function App(){
 const context=useProductContext();
 const issueKey=context?.extension?.issue?.key||context?.platformContext?.issueKey||"";
 const [preview,setPreview]=useState(null),[errors,setErrors]=useState([]),[loading,setLoading]=useState(true),[validating,setValidating]=useState(false),[creating,setCreating]=useState(false),[validated,setValidated]=useState(false),[productionConfirm,setProductionConfirm]=useState(false),[message,setMessage]=useState(null);
 const load=async()=>{if(!issueKey)return;setLoading(true);try{const r=await invoke("getShipmentPreview",{issueKey});setPreview(r.preview);setErrors(r.errors||[])}catch(e){setMessage({a:"error",t:"Could not load shipment",b:String(e)})}finally{setLoading(false)}};
 useEffect(()=>{load()},[issueKey]);
 const validate=async()=>{setValidating(true);setMessage(null);try{const r=await invoke("validateShipmentAddress",{issueKey});setPreview(r.preview||preview);setErrors(r.errors||[]);setValidated(Boolean(r.ok));setMessage(r.ok?{a:"confirmation",t:"Address validated",b:"DHL accepted the destination for delivery capability/address validation. Review the shipment below before creating it."}:{a:"error",t:"Validation failed",b:(r.errors||[]).join(" • ")})}catch(e){setValidated(false);setMessage({a:"error",t:"Validation failed",b:String(e)})}finally{setValidating(false)}};
 const create=async()=>{setCreating(true);setMessage(null);try{const r=await invoke("createDhlShipment",{issueKey,confirmedProduction:productionConfirm});if(r.ok){setMessage({a:"confirmation",t:"DHL shipment created",b:`Waybill ${r.trackingNumber} was written back to Jira. ${r.fieldsUpdated} Jira field(s) updated.`});setErrors([]);setValidated(false);await load()}else{setMessage({a:r.uncertain?"warning":"error",t:r.uncertain?"Shipment state needs checking":"Shipment not created",b:(r.errors||[]).join(" • ")+(r.uncertain?" Do not retry blindly; confirm the DHL transaction state first.":"")})}}catch(e){setMessage({a:"error",t:"Shipment creation failed",b:String(e)})}finally{setCreating(false)}};
 if(!issueKey)return <SectionMessage appearance="warning">Open this panel from a Jira issue.</SectionMessage>;
 if(loading)return <Spinner size="large"/>;
 if(!preview)return <SectionMessage appearance="error">Shipment preview could not be loaded.</SectionMessage>;
 const p=preview;
 return <Stack space="space.300">
  <Heading as="h2">Create DHL Express Shipment</Heading>
  <SectionMessage appearance={p.environment==="production"?"warning":"information"}>{p.environment==="production"?"PRODUCTION — this creates a real DHL shipment.":"TEST MODE — use this to validate the configuration without creating a live production transaction."}</SectionMessage>
  {message&&<SectionMessage appearance={message.a} title={message.t}>{message.b}</SectionMessage>}
  {errors.length>0&&<SectionMessage appearance="error" title="Shipment is not ready">{errors.join(" • ")}</SectionMessage>}
  <Heading as="h3">Recipient</Heading>
  <Row label="Company" value={p.recipient.company}/><Row label="Contact" value={p.recipient.name}/><Row label="Phone" value={p.recipient.phone}/><Row label="Email" value={p.recipient.email}/>
  <Row label="Address" value={[p.recipient.address1,p.recipient.address2,p.recipient.address3].filter(Boolean).join(", ")}/><Row label="City" value={p.recipient.city}/><Row label="Postal code" value={p.recipient.postalCode}/><Row label="Country" value={p.recipient.countryCode}/>
  <Heading as="h3">Shipment</Heading>
  <Row label="Issue" value={p.issueKey}/><Row label="Contents" value={p.shipment.contents}/><Row label="Reference" value={p.shipment.reference}/><Row label="Packages" value={String(p.shipment.packageCount)}/><Row label="Weight" value={p.shipment.weight?`${p.shipment.weight} kg`:""}/><Row label="Dimensions" value={p.shipment.length&&p.shipment.width&&p.shipment.height?`${p.shipment.length} × ${p.shipment.width} × ${p.shipment.height} cm`:"Not configured"}/>
  {p.shipment.declaredValue>0&&<Row label="Declared value" value={`${p.shipment.declaredValue} ${p.shipment.currency||""}`}/>}<Row label="Existing tracking" value={p.existingTracking}/>
  <Heading as="h3">Shipper</Heading><Row label="Company" value={p.shipper.company}/><Row label="Contact" value={p.shipper.name}/><Row label="Address" value={[p.shipper.address1,p.shipper.address2,p.shipper.address3].filter(Boolean).join(", ")}/><Row label="City / country" value={[p.shipper.city,p.shipper.countryCode].filter(Boolean).join(", ")}/>
  <Button onClick={validate} isLoading={validating} isDisabled={errors.length>0}>Validate address with DHL</Button>
  {p.environment==="production"&&<Checkbox label="I confirm this will create a real DHL Express shipment" isChecked={productionConfirm} onChange={()=>setProductionConfirm(!productionConfirm)}/>} 
  <Button appearance="primary" onClick={create} isLoading={creating} isDisabled={!validated||(p.environment==="production"&&!productionConfirm)}>Create DHL Shipment</Button>
 </Stack>
}
ForgeReconciler.render(<React.StrictMode><App/></React.StrictMode>);
