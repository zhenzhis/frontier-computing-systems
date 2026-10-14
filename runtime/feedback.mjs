import {collectFeedback} from './feedback-core.mjs';
const [project,repo]=process.argv.slice(2);
try{if(!project||!repo)throw Error('Usage: node runtime/feedback.mjs <project> <owner/repo>');console.log(JSON.stringify(await collectFeedback(project,repo)));}
catch(error){console.error(String(error.message).replace(/\bsk[-_][\w-]+/g,'[redacted]'));process.exitCode=1;}
