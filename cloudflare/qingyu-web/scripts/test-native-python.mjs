import {spawnSync} from 'node:child_process';
const candidates=process.env.QINGYU_PYTHON?[process.env.QINGYU_PYTHON]:['python3.13','python3.12','python3.11','python3'];
const executable=candidates.find(name=>{
 const probe=spawnSync(name,['-c','import sys; print(int(sys.version_info >= (3,11)))'],{encoding:'utf8'});
 return probe.status===0&&probe.stdout.trim()==='1';
});
if(!executable)throw new Error('Native adapter tests require Python3.11+; set QINGYU_PYTHON to an installed interpreter.');
const run=spawnSync(executable,['-m','unittest','discover','-s','test','-p','native_*_test.py'],{stdio:'inherit'});
process.exitCode=run.status??1;
