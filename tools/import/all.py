import sys,glob,os,json,re
sys.path.insert(0,os.path.dirname(__file__))
from doctext import doc_text
import zipfile
from xml.etree import ElementTree as ET
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
SRC=sys.argv[1]; OUT=sys.argv[2]
def ptext(p):
    s=''
    for el in p.iter():
        if el.tag==W+'t': s+=el.text or ''
        elif el.tag==W+'tab': s+='\t'
    return s
def docx_info(p):
    z=zipfile.ZipFile(p); root=ET.fromstring(z.read('word/document.xml')); body=root.find(W+'body'); lines=[]
    for ch in body:
        if ch.tag==W+'p': lines.append(ptext(ch))
        elif ch.tag==W+'tbl':
            for tr in ch.iter(W+'tr'):
                lines.append(' | '.join(' / '.join(ptext(pp).strip() for pp in tc.iter(W+'p') if ptext(pp).strip()) for tc in tr.findall(W+'tc')))
    sect=body.find(W+'sectPr'); pg=sect.find(W+'pgSz'); mar=sect.find(W+'pgMar')
    fonts={}; sizes={}
    for r in body.iter(W+'rPr'):
        f=r.find(W+'rFonts'); sz=r.find(W+'sz')
        if f is not None and f.get(W+'ascii'): fonts[f.get(W+'ascii')]=fonts.get(f.get(W+'ascii'),0)+1
        if sz is not None: k=int(sz.get(W+'val'))/2; sizes[k]=sizes.get(k,0)+1
    names=z.namelist()
    return dict(lines=lines, pg=[pg.get(W+'w'),pg.get(W+'h')], mar=[mar.get(W+'top'),mar.get(W+'left'),mar.get(W+'right'),mar.get(W+'bottom')],
      fonts=fonts, sizes=sizes, images=[n for n in names if 'media/' in n], hf=[n for n in names if re.search(r'(header|footer)\d',n)],
      ntbl=len(body.findall('.//'+W+'tbl')), pbreaks=sum(1 for b in body.iter(W+'br') if b.get(W+'type')=='page'))
recs=[]
for p in sorted(glob.glob(SRC+'/**/*.*',recursive=True)):
    rel=os.path.relpath(p,SRC).replace(os.sep,'/'); ext=p.rsplit('.',1)[1].lower()
    try:
        if ext=='docx': r=docx_info(p)
        elif ext=='doc': r=dict(lines=doc_text(p).replace('\x07',' | ').split('\r'))
        elif ext=='pdf':
            import pymupdf; d=pymupdf.open(p); r=dict(lines='\n'.join(pg.get_text() for pg in d).split('\n'))
        else: continue
    except Exception as e: r=dict(lines=[],err=str(e))
    r['file']=rel; r['ext']=ext; recs.append(r)
json.dump(recs,open(OUT,'w',encoding='utf8'),ensure_ascii=False)
print(len(recs), [x['file'] for x in recs if x.get('err')])
