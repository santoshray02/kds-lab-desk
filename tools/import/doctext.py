import olefile, struct, sys
def doc_text(path):
    o=olefile.OleFileIO(path); wd=o.openstream('WordDocument').read()
    flags=struct.unpack_from('<H',wd,0xA)[0]
    tbl=o.openstream('1Table' if flags&0x200 else '0Table').read()
    fcClx,lcbClx=struct.unpack_from('<II',wd,0x1A2)
    clx=tbl[fcClx:fcClx+lcbClx]; i=0
    while clx[i]==1: i+=3+struct.unpack_from('<H',clx,i+1)[0]
    assert clx[i]==2; lcb=struct.unpack_from('<I',clx,i+1)[0]; pct=clx[i+5:i+5+lcb]
    n=(lcb-4)//12; cps=struct.unpack_from('<%dI'%(n+1),pct,0); out=[]
    for k in range(n):
        fc=struct.unpack_from('<I',pct,4*(n+1)+8*k+2)[0]; ln=cps[k+1]-cps[k]
        if fc&0x40000000: s=wd[(fc&0x3FFFFFFF)//2:(fc&0x3FFFFFFF)//2+ln].decode('cp1252','replace')
        else: s=wd[fc:fc+2*ln].decode('utf-16le','replace')
        out.append(s)
    t=''.join(out)
    ccpText=struct.unpack_from('<I',wd,0x4C)[0]
    return t[:ccpText]
if __name__=='__main__':
    t=doc_text(sys.argv[1]); print(t.replace('\r','\n').replace('\x07',' | ')[:3000])
