with recursive t(id,tag,index,hash) as (
   (
      select * from (
         select id,tag,index,hash 
         from messages 
         where tag = 'server' and index is not null
         union 
         select 0,'server',0,null
      ) a
      order by id desc limit 1
   )
   union all
   (
      select messages.id, messages.tag, t.index+1, 
         case when t.index = 0 then sha256(messages.messagestring::bytea) 
         else sha256(t.hash || sha256(messages.messagestring::bytea)) 
         end
      from messages 
         inner join t on messages.id > t.id and messages.tag = t.tag and messages.index is null
      order by id limit 1
   )
)
update messages set 
   index = t.index,
   hash = t.hash
from t where t.id = messages.id;
