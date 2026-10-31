export function executionPath(input,platform=process.platform){
 const normalized=input.replaceAll(String.fromCharCode(92),'/');
 return platform==='linux'&&normalized[1]===':'?`/mnt/${normalized[0].toLowerCase()}/${normalized.slice(3)}`:input;
}
