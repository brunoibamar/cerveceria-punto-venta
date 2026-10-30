// Solo configuración pública. Los permisos se comprueban en PostgreSQL.
const CloudConfig = Object.freeze({
  url: 'https://qhxsqyyytbxlnfxfhzcb.supabase.co',
  key: 'sb_publishable_kGqIAc1i34Z53APgs1TuZQ_Df3h3LRr',
  businessId: new URLSearchParams(location.search).get('env')==='production' ? '451bed72-845f-421b-bcfc-2f4e073bb334' : '71bcfcc3-4e5b-4b8a-bdea-595c5bc8c4a2',
  environment: new URLSearchParams(location.search).get('env')==='production' ? 'production':'test',
  link(path) { const url=new URL(path,location.href);if(this.environment==='production')url.searchParams.set('env','production');return url.href; }
});
