"""Render an exactly 10-minute narrated walkthrough using actual execution evidence.
Requires Pillow and ffmpeg with the flite filter. No simulated execution outputs.
"""
import json, subprocess, textwrap, shutil, re
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'submission'; TMP=ROOT.parent/'tmp/video';TMP.mkdir(parents=True,exist_ok=True)
B=json.loads((ROOT/'evidence/benchmark-results.json').read_text()); DEMO=json.loads((ROOT/'evidence/demo-results.json').read_text()); S=DEMO['steps']; OP={x['operation']:x for x in B['operations']}
def step(prefix):return next(x['output'] for x in S if x['title'].startswith(prefix))
upload=step('04');opened=step('07');revoked=step('09');audit=step('11')['events'];dep=B['deployment'];large=B['files'][-1];scale=B['scales'][-1]
scenes=[
('The problem and the goal',45,"""This is MediLedger, the implementation for Assignment One: blockchain-based healthcare data sharing. Healthcare organizations often keep separate information systems, which makes controlled sharing difficult. Patients may have little visibility into who receives their records. Our goal is to demonstrate patient-owned consent, encrypted file sharing and an inspectable audit trail. The project contains a browser dashboard, a real Solidity contract, an authenticated gateway and two IPFS storage peers. All records in this demonstration are fictional. The contract is deployed to a local Ethereum-compatible chain, not a public testnet. This narrated walkthrough uses the actual interface and recorded execution evidence from the supplied project. It explains what works, how it was measured, and the limitations that remain."""),
('Architecture and trust boundaries',55,"""The architecture separates three responsibilities: clinical content, encryption keys and authorization. The patient's browser encrypts each file before upload. Two IPFS peers retain the encrypted object in independent persistent stores. The blockchain records the owner, content identifier, ciphertext hash and permissions. It does not contain the medical plaintext or the secret file key. A gateway authenticates signed requests and checks the current contract state before releasing an encrypted key envelope. A separate auditor account records allowed and denied access decisions. The administrator approves doctors and hospitals, but approval alone does not give access to a patient's record. A patient must still grant consent. Both storage peers and the local blockchain run on one host in this evaluation. Therefore, we demonstrate protocol separation and replication, while acknowledging that the gateway and the single host remain availability dependencies."""),
('Technology stack and deployment',35,f"""The contract uses Solidity version zero point eight point thirty, with the optimizer enabled and the Shanghai EVM target. Ganache provides local chain thirty-one thousand three hundred thirty-seven, with a quarter-second block interval. Ethers handles wallet signatures and blockchain calls. Express provides the encrypted-file gateway. Helia and Unix F S provide two IPFS stores. Native Web Crypto performs AES G C M encryption and R S A O A E P key wrapping. The measured deployment consumed {dep['gasUsed']} gas. Its address, transaction hash, receipt and compiled artifact are included in the evidence folder."""),
('Register patients, doctors and hospitals',60,"""Registration is the first functional workflow. A patient registers a wallet and public encryption key, and becomes active immediately. Doctors and hospitals use separate roles and begin in a pending state. The administrator then approves their eligibility. These are real transactions from the scripted demonstration, rather than placeholder database entries. The contract prevents a wallet from registering twice and rejects approval by a non-administrator. Approval represents a decision made after checking credentials outside this prototype; it does not automatically verify a professional licence. Each account uses two different kinds of key. The Ethereum wallet signs transactions and gateway requests. The RSA key pair protects record keys. In the browser, its private CryptoKey stays in IndexedDB and is non-exportable. The same browser profile and hostname must be used again. Clearing that browser data can make previously encrypted files unreadable because key recovery has not yet been implemented."""),
('Encrypt, upload and record ownership',60,f"""For upload, the patient selects the supplied fictional medical note. The client creates a fresh random thirty-two-byte AES key and a fresh twelve-byte nonce. It encrypts the file bytes, filename and content type using authenticated AES G C M encryption. The AES key is wrapped for the patient using their RSA public key. Only ciphertext is sent to storage. Both IPFS peers pin the same object, and their content identifiers must agree. The patient then confirms ownership on the blockchain using the content identifier and integrity commitments. Finally, the encrypted owner key is saved in the gateway index. The demonstrated upload created record number {upload['recordId']} from {upload['originalBytes']} original bytes. The interface only reports success after these stages finish. These stages cannot form one atomic blockchain transaction, so the report discusses interrupted uploads and missing-key recovery as explicit remaining limitations."""),
('Share and decrypt with approved providers',75,"""Before sharing, the doctor attempts to open the patient's record. The gateway rejects the request because no permission exists, and the denial is recorded on-chain. The patient then grants access. To do this, the patient unwraps the existing AES key locally and encrypts it again for the doctor's registered RSA public key. The grant transaction commits the recipient, optional expiry and encrypted-key hash. The gateway accepts that envelope only when it matches the current patient-owned permission. The doctor now signs a fresh download request. The gateway verifies the signature, consumes its single-use nonce, records an access decision and checks consent again before release. The doctor verifies the ciphertext and envelope hashes, unwraps the AES key and decrypts the file. The demonstration compares the resulting bytes with the original and confirms an exact match. A separate grant to the hospital also succeeds. The hospital receives its own encrypted key envelope. Sharing with one provider does not require exposing the patient's private key or distributing one common recipient key to every provider."""),
('Revoke access and inspect the audit',60,"""The patient now revokes the doctor's permission. The contract deletes that specific permission entry, and a later doctor request is denied. The hospital's separate permission remains valid. This demonstrates record-level and recipient-level consent rather than a single global sharing switch. The audit history contains registration, provider approval, ownership creation, grant, revoke and read-decision events. Denied reads are recorded without reverting the audit transaction, because reverted transactions would discard their events. The gateway also records API response outcomes in a local hash-linked log. Its history is not independently anchored, so it cannot be described as an immutable public ledger. An allowed read event proves a gateway decision, not that a human viewed the record. Direct ciphertext retrieval and offline decryption are outside this application's observation. Most importantly, revocation cannot erase plaintext or a key already downloaded. One security test deliberately confirms that limitation."""),
('The smart contract in detail',50,"""The contract contains profiles, records and permissions. Profiles store the role, eligibility flag and public encryption key. Records store a patient owner, content identifier, ciphertext hash and creation time. Permissions are indexed by record and recipient. They contain an active flag, expiry and encrypted-key commitment. The owner-only modifier compares the caller with the stored patient owner. The grant function additionally requires an approved doctor or hospital and a valid future expiry, unless expiry is zero. The access function permits the owner, or a provider whose eligibility and record permission remain active. Revocation deletes a permission, and provider suspension blocks access through the profile check. The contract has no fund-transfer logic or unbounded state-changing loops. These choices simplify reasoning, but they do not replace an independent security review."""),
('Measured performance and scalability',80,f"""The evaluation includes actual transaction receipts and five trials at each of three file sizes: one kibibyte, one hundred kibibytes and one mebibyte. For one mebibyte, mean upload latency was {large['upload']['mean']:.0f} milliseconds, while mean download latency was {large['download']['mean']:.0f} milliseconds. These are complete workflow times, including their documented encryption, gateway and confirmation stages. They exclude human wallet approval and public-network delay. Transaction fee is actual gas used multiplied by effective gas price, divided by ten to the eighteenth. Raw prices and hashes are preserved, because the local auditor signer used an unusually small base fee. Gas is the better comparison when signer fee policies differ. The transaction-only load scenarios submitted ten, fifty and one hundred records using one, four and eight workers. The largest scenario confirmed all {scale['success']} transactions and achieved {scale['tps']:.2f} transactions per second. Aggregate measured CPU use was {scale['cpuPercentOneCore']:.1f} percent relative to one core. Memory and application-payload bandwidth were also measured. These scenarios jointly change volume and concurrency; they do not prove linear scaling or predict public-chain performance."""),
('Security results and practical limits',45,"""All twenty-two functional and security tests passed. They cover role registration, unauthorized approval, encrypted round trips, independent IPFS copies, sharing, missing consent, revocation, expiry, provider suspension, modified ciphertext, the wrong private key, replayed signatures, substituted request bodies and forged audit calls. These tests support the specified local behaviors. They do not establish production readiness. The browser requires HTTPS or localhost for native cryptography. Remote HTTP preview was used for layout inspection, while the shared cryptographic workflow was executed in integration tests. Clinical credential verification, emergency access, key recovery, independent audit anchoring and geographically separate infrastructure remain future work. The local demonstration wallets must never hold real funds or real patient information."""),
('Challenges, next steps and conclusion',35,"""The next priorities are durable recovery for interrupted uploads, patient-controlled key backup and rotation, independently anchored gateway logs, and replicated services on separate hosts. Larger studies should vary concurrency and record volume independently, repeat each workload, introduce network delay and test failure recovery. The complete package includes source code, the dependency lockfile, measured evidence, the report, this ten-minute walkthrough and a viva guide. The assignment permits coding assistance but requires the student to explain the implementation. Reproduce the synthetic workflow and rehearse it in your own words before presenting. MediLedger demonstrates patient-controlled encrypted sharing while making its trust assumptions and limitations explicit."""),
]
assert sum(s[1] for s in scenes)==600
FONT=Path('/usr/share/fonts/truetype/dejavu')
def font(size,bold=False,mono=False):return ImageFont.truetype(str(FONT/('DejaVuSansMono.ttf' if mono else 'DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf')),size)
NAVY='#102e3d';TEAL='#006b66';INK='#192d38';MUTED='#546c7a';LINE='#d5e0e5'
def wrapped(draw,text,xy,maxwidth,size=25,fill=INK,bold=False,line=36,mono=False):
    x,y=xy; ft=font(size,bold,mono)
    for paragraph in str(text).split('\n'):
        words=paragraph.split();current=''
        for word in words:
            candidate=(current+' '+word).strip()
            if draw.textlength(candidate,font=ft)>maxwidth and current:
                draw.text((x,y),current,font=ft,fill=fill);y+=line;current=word
            else:current=candidate
        if current:draw.text((x,y),current,font=ft,fill=fill);y+=line
        if not words:y+=line/2
    return y
def box(draw,rect,title,body,fill='#eef5f6'):
    draw.rounded_rectangle(rect,10,fill=fill,outline=LINE,width=2);x,y,x2,y2=rect
    y=wrapped(draw,title,(x+20,y+17),x2-x-40,24,bold=True,line=32)
    wrapped(draw,body,(x+20,y+10),x2-x-40,21,fill=MUTED,line=30)
def rows(draw,items,y=175,widths=(320,800)):
    for label,value in items:
        draw.line((60,y+58,1220,y+58),fill=LINE,width=1)
        wrapped(draw,label,(65,y),widths[0]-20,22,bold=True,line=28)
        wrapped(draw,value,(65+widths[0],y),widths[1]-25,22,line=28);y+=77
def base(i,title,start,duration):
    im=Image.new('RGB',(1280,720),'#ffffff');draw=ImageDraw.Draw(im)
    draw.rectangle((0,0,1280,111),fill=NAVY);draw.text((45,18),'MEDILEDGER  /  ASSIGNMENT 1',font=font(17,bold=True),fill='#8bd6ce')
    draw.text((45,52),title,font=font(32,bold=True),fill='white')
    draw.line((45,669,1235,669),fill=LINE,width=1)
    draw.text((45,685),'Local execution evidence | Synthetic records | Narrated technical walkthrough',font=font(15),fill=MUTED)
    draw.text((1100,685),f'{start//60:02d}:{start%60:02d} - {(start+duration)//60:02d}:{(start+duration)%60:02d}',font=font(14),fill=MUTED)
    return im,draw
start=0;script=['# Assignment 1 - ten-minute demonstration script','', 'This is a narrated evidence walkthrough, with synthetic speech. Demonstration values come from actual local execution. It is not a claim of a continuous live browser recording.','']
for i,(title,duration,narration) in enumerate(scenes):
    narration=' '.join(narration.split());(TMP/f'narration-{i:02d}.txt').write_text(narration)
    script.extend([f'## {start//60:02d}:{start%60:02d}-{(start+duration)//60:02d}:{(start+duration)%60:02d} | {title}','',narration,''])
    im,draw=base(i,title,start,duration)
    if i==0:
        wrapped(draw,'Blockchain-based healthcare data sharing',(65,157),600,45,bold=True,line=57)
        wrapped(draw,'Patient-owned consent. Encrypted files. Inspectable access decisions.',(65,360),540,29,line=42)
        screenshot=Image.open(ROOT/'evidence/dashboard.jpg').convert('RGB');screenshot.thumbnail((550,410))
        im.paste(screenshot,(680,170));draw.rectangle((679,169,681+screenshot.width,171+screenshot.height),outline=LINE,width=2)
        wrapped(draw,'Actual dashboard before registration',(680,570),550,21,bold=True,line=28)
        wrapped(draw,'22 passing tests | two IPFS peers',(680,611),550,20,fill=TEAL,line=26)
    elif i==1:
        box(draw,(55,145,565,265),'Patient / provider client','Wallet signing + Web Crypto\nPrivate RSA key stays in the browser')
        box(draw,(715,145,1225,265),'Blockchain','Owner, CID, integrity, consent\nImmutable state-change events')
        box(draw,(370,331,910,446),'Signed encrypted-file gateway','Check consent + submit read audit\nStore recipient-specific key envelopes')
        box(draw,(55,514,565,629),'IPFS peer A','Independent persistent ciphertext store')
        box(draw,(715,514,1225,629),'IPFS peer B','Same content ID, separate stored copy')
        for a,b in [((565,205),(715,205)),((310,265),(525,331)),((970,265),(755,331)),((490,446),(310,514)),((790,446),(970,514))]:draw.line((*a,*b),fill=TEAL,width=4)
    elif i==2:
        rows(draw,[('Contract','Solidity 0.8.30 | Shanghai | optimizer: 200 runs'),('Local blockchain','Ganache 7.9.2 | chain 31337 | 0.25 s blocks'),('Application','JavaScript | ethers 6.15.0 | Express 5.1.0'),('Encryption','AES-256-GCM + RSA-OAEP-SHA-256'),('Storage','Helia 5.4.2 | two persistent IPFS peers'),('Deployment gas',f"{int(dep['gasUsed']):,} gas | actual receipt retained")],y=155)
    elif i==3:
        regs=[x for x in S if x['title'].startswith('02')]
        rows(draw,[(x['title'].split('Register ')[1],f"Registered on-chain | {x['output']['gasUsed']} gas | {'Active' if x['output']['active'] else 'Pending approval'}") for x in regs]+[('Administrator','Doctor approved: true | Hospital approved: true')],y=161)
        box(draw,(60,503,1220,621),'Eligibility is separate from consent','Provider approval does not grant access to any patient record.')
    elif i==4:
        rows(draw,[('Original fictional note',f"{upload['originalBytes']} bytes | encrypted before upload"),('Replicated storage','2 IPFS peers | matching content identifiers'),('Patient-owned record',f"Record #{upload['recordId']} | ownership transaction confirmed")],y=160)
        wrapped(draw,'Actual IPFS content identifier',(65,425),1150,22,bold=True)
        wrapped(draw,upload['cid'],(65,466),1150,20,mono=True,line=30)
        wrapped(draw,'Actual ownership transaction',(65,523),1150,22,bold=True)
        wrapped(draw,upload['transaction'],(65,562),1150,18,mono=True,line=27)
    elif i==5:
        box(draw,(50,149,490,328),'Before patient consent','Doctor read: DENIED\nDenial recorded on-chain')
        box(draw,(50,358,490,567),'After patient consent','Doctor read: ALLOWED\nDecrypted bytes match: TRUE\nHospital round trip: TRUE')
        draw.rounded_rectangle((530,149,1230,623),10,fill='#f1f5f8',outline=LINE,width=2)
        wrapped(draw,'ACTUAL DECRYPTED TEST CONTENT',(550,168),650,19,bold=True)
        preview='\n'.join(opened['plaintext'].splitlines()[:12])
        wrapped(draw,preview,(550,212),650,18,mono=True,line=25)
    elif i==6:
        box(draw,(50,145,605,290),'After doctor revocation','Doctor allowed: FALSE\nHospital still allowed: TRUE')
        box(draw,(635,145,1230,290),'Audit meaning','Access decision, not proof of viewing\nEarlier copies cannot be recalled')
        draw.text((60,325),'RECORDED READ DECISIONS',font=font(23,bold=True),fill=INK)
        read=[a for a in audit if a['event']=='ReadAudit']
        for j,a in enumerate(read[-7:]):
            draw.text((65,371+j*35),f"Block {a['block']:>4}   {a['actor'][:10]}...   {'ALLOWED' if a['allowed'] else 'DENIED'}",font=font(21,mono=True),fill=TEAL if a['allowed'] else '#9a3029')
    elif i==7:
        box(draw,(50,145,480,316),'Data structures','Profile: role + eligibility + key\nRecord: owner + CID + digest\nPermission: active + expiry + hash')
        box(draw,(50,345,480,611),'Invariants','Only patient owner grants or revokes\nOnly admin approves providers\nOnly auditor records read decisions\nNo unbounded state-changing loop')
        source=(ROOT/'contracts/HealthcareRecords.sol').read_text();code=source[source.index('    function canAccess'):source.index('    /// @dev Only')].strip()
        draw.rounded_rectangle((515,145,1230,611),10,fill=NAVY)
        wrapped(draw,'FROM HealthcareRecords.sol',(538,168),665,20,bold=True,fill='#8bd6ce')
        lines=[]
        for line in code.splitlines():lines.extend(textwrap.wrap(line,64,replace_whitespace=False,drop_whitespace=False) or [' '])
        y=215
        for line in lines:draw.text((538,y),line,font=font(17,mono=True),fill='white');y+=27
    elif i==8:
        rows(draw,[('Deployment',f"{int(dep['gasUsed']):,} gas | actual gas-price receipts supplied"),('1 MiB upload / download',f"{large['upload']['mean']:.0f} ms / {large['download']['mean']:.0f} ms mean"),('Largest load',f"100 transactions | 8 workers | {scale['success']}/100 confirmed"),('Throughput / CPU',f"{scale['tps']:.2f} TPS | {scale['cpuPercentOneCore']:.1f}% of one core"),('Measured process memory',f"{sum([scale['memoryMiB']['gatewayAndDriver'],scale['memoryMiB']['chain'],*scale['memoryMiB']['storage']]):.0f} MiB total sampled RSS"),('Gateway payload rate',f"{B['network']['gatewayMiBPerSecond']:.2f} MiB/s | excludes protocol overhead")],y=150)
    elif i==9:
        draw.text((60,150),'22 / 22 tests passed',font=font(48,bold=True),fill=TEAL)
        rows(draw,[('Authorization','Non-owner grants, unapproved providers and role escalation rejected'),('Cryptography','Wrong recipient key and modified ciphertext rejected'),('Request security','Replayed signature and changed request body rejected'),('Consent lifecycle','Missing, revoked, expired and suspended access rejected'),('Explicit limit','Earlier copies remain readable after revocation')],y=238,widths=(285,850))
    else:
        rows(draw,[('Recovery','Durable upload journal, patient key backup and rotation'),('Trust and availability','Independent audit anchors and services on separate hosts'),('Stronger evaluation','Repeated factorial workloads, WAN delay and fault injection'),('Student preparation','Read the source, reproduce the workflow and use the viva guide')],y=161,widths=(310,850))
        wrapped(draw,'Source + report + measured evidence + walkthrough',(65,526),1130,29,bold=True,line=40)
        wrapped(draw,'An educational implementation with clearly stated limits.',(65,578),1130,24,fill=MUTED)
    image_path=TMP/f'scene-{i:02d}.png';im.save(image_path)
    start+=duration
(OUT/'DEMONSTRATION_SCRIPT.md').write_text('\n'.join(script))
manifest=[]
def run(args):subprocess.run(args,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
for i,(title,duration,narration) in enumerate(scenes):
    wav=TMP/f'voice-{i:02d}.wav';clip=TMP/f'clip-{i:02d}.mp4'
    run(['ffmpeg','-y','-f','lavfi','-i',f'flite=textfile={TMP/f"narration-{i:02d}.txt"}:voice=slt','-ar','44100',str(wav)])
    spoken=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(wav)]))
    ratio=spoken/(duration-1.5)
    if not .5<=ratio<=2:raise ValueError(f'Unnatural narration speed scene {i}: {ratio}')
    run(['ffmpeg','-y','-loop','1','-framerate','2','-i',str(TMP/f'scene-{i:02d}.png'),'-i',str(wav),'-vf',f'format=yuv420p,fade=t=in:st=0:d=0.3,fade=t=out:st={duration-.3}:d=0.3','-af',f'atempo={ratio},apad','-t',str(duration),'-c:v','libx264','-preset','ultrafast','-crf','23','-r','10','-threads','2','-c:a','aac','-b:a','80k','-movflags','+faststart',str(clip)])
    manifest.append({'chapter':i+1,'title':title,'seconds':duration,'narrationWords':len(narration.split()),'originalSpeechSeconds':spoken,'tempo':ratio})
    print('Rendered chapter',i+1,flush=True)
(TMP/'concat.txt').write_text('\n'.join(f"file '{TMP/f'clip-{i:02d}.mp4'}'" for i in range(len(scenes))))
final=OUT/'Assignment_1_Demonstration_10min.mp4'
run(['ffmpeg','-y','-f','concat','-safe','0','-i',str(TMP/'concat.txt'),'-c','copy','-t','600','-movflags','+faststart',str(final)])
(ROOT/'evidence/video-manifest.json').write_text(json.dumps(manifest,indent=2))
print(final)
