from pathlib import Path
from pypdf import PdfReader
from pdf2image import convert_from_path
from PIL import Image,ImageOps,ImageDraw
root=Path(__file__).parent/'render'
pdf=root/'document.pdf'
r=PdfReader(pdf)
print('PAGE COUNT',len(r.pages))
for i,p in enumerate(r.pages,1):
    text=p.extract_text()
    lines=[x for x in text.splitlines() if x.strip()]
    print(i, len(text), ' | '.join(lines[:2]))
convert_from_path(str(pdf),dpi=130,output_folder=str(root),fmt='png',output_file='page',thread_count=4)
images=sorted(root.glob('page*.png'))
for i in range(0,len(images),6):
    sheet=Image.new('RGB',(1050,1485),'#d8d8d8')
    for j,impath in enumerate(images[i:i+6]):
        im=Image.open(impath);im.thumbnail((510,460))
        x=(j%2)*525+(525-im.width)//2;y=(j//2)*495+22
        sheet.paste(im,(x,y));ImageDraw.Draw(sheet).text((j%2*525+15,j//2*495+5),str(i+j+1),fill='black')
    sheet.save(root/f'contact-{i//6+1}.jpg')
