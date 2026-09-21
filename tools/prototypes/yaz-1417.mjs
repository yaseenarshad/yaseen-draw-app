import { mkdir, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import { stringify } from 'yaml'

// A complete scratch vault for reviewing the real app. Never reads or writes a user's vault.
const base = '/tmp/yaz-1417'
const vault = path.join(base, 'YAZ-1417 Review')
const userdata = path.join(base, 'userdata')
await mkdir(path.join(vault, 'Candidates'), { recursive: true })
await mkdir(userdata, { recursive: true })
const stages = ['Not Contacted', 'Opening Message Sent', 'Awaiting Reply', 'In Convo', 'Scheduled Meeting']
const columns = {
  Name: { kind: 'text' }, Status: { kind: 'select', options: stages }, 'Next Action': { kind: 'text' },
  'AI Fit Score': { kind: 'number' }, platform: { kind: 'select', options: ['Upwork', 'Fiverr', 'Referral'] },
  proposal_received: { kind: 'checkbox' }, 'Next Interview': { kind: 'date' },
  discovery_keywords: { kind: 'list' }, skills: { kind: 'multi-select', options: ['TypeScript', 'Python', 'Agents', 'React'] },
  related: { kind: 'link' }, collaborators: { kind: 'multi-link' }, Notes: { kind: 'text' },
}
const order = ['file.name', 'note.Status', 'note.platform', 'note.AI Fit Score', 'note.Next Action', 'note.Next Interview', 'note.skills', 'note.proposal_received']
const file = path.join(vault, 'AI CANDIDATES.md')
// Re-running the launcher must preserve review edits.
try { await access(file); console.log(`Existing review vault preserved: ${vault}`); process.exit(0) } catch {}
const note = (properties, body = '') => `---\n${stringify(properties)}---\n\n${body}\n`
await writeFile(file, note({ folder_page: true, folder_pages: ['[[AI DEV HIRE]]'], folder_page_settings: {
  columns, folder: 'Candidates', defaultView: 'Board', views: [
    { type: 'outline', name: 'Outline', outline: '- Sample candidates for the property-system review.\n- Changes here affect only this scratch vault.' },
    { type: 'table', name: 'Candidates', order },
    { type: 'board', name: 'Board', order: ['file.name', 'note.platform', 'note.AI Fit Score'], groupBy: { property: 'note.Status', direction: 'ASC' }, showEmptyColumns: true, cardSize: 230 },
    { type: 'table', name: 'All fields', order: ['file.name', ...Object.keys(columns).map(k => `note.${k}`)] },
  ],
} }, '# AI CANDIDATES\n\nProperty-system review · sample data'))
await writeFile(path.join(vault, 'AI DEV HIRE.md'), note({ folder_page: true, folder_page_settings: { views: [{ type: 'outline', name: 'Outline', outline: '- [[AI CANDIDATES]]\n- [[Interview Strategy]]' }] } }))
await writeFile(path.join(vault, 'Interview Strategy.md'), note({ folder_pages: ['[[AI DEV HIRE]]'] }, '# Interview Strategy\n\nSample linked page.'))
await writeFile(path.join(vault, 'Home.md'), note({ folder_page: true, folder_page_settings: { views: [{type:'outline',name:'Outline',outline:'- [[AI DEV HIRE]]'}] } }))
const people = [['Alex Morgan',0,'Upwork',8],['Sam Rivera',0,'Fiverr',7],['Jordan Lee',0,'Referral',9],['Taylor Kim',1,'Upwork',8]]
for (const [name,stage,platform,score] of people) {
 await writeFile(path.join(vault,'Candidates',`${name}.md`), note({folder_pages:['[[AI CANDIDATES]]'],Name:name,Status:stages[stage],platform,'AI Fit Score':score,'Next Action':'Review portfolio',proposal_received:true,skills:['TypeScript','Agents'],discovery_keywords:['automation'],related:'[[Interview Strategy]]',collaborators:[],Notes:'Synthetic candidate for UI review.'},`# ${name}\n\nSample content. You can safely edit this note.`))
}
await writeFile(path.join(userdata,'yaseendraw.json'), JSON.stringify({version:1,sidebarLens:'topics',recents:[{path:vault,lastOpened:Date.now()}],windows:[{id:'yaz-1417-review',root:vault,file,tabs:[file],bounds:{x:100,y:80,width:1450,height:900}}],folders:{[vault]:{expanded:[],topicsExpanded:[],lastFile:file,folds:{},baseGroups:{}}}},null,2))
console.log(`Review vault: ${vault}\nUser data: ${userdata}`)
