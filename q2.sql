explain with recursive t(id,tag,index,hash) as (
    (
    select * from (
        (select id,tag,index,hash from messages where tag = 'server2' and index is not null order by id desc limit 1)
        union 
        select 0,'server2',0,null
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


insert into taghashes (tag,index,hash)
values ('server', 1, sha256(decode('78f60d7c56ebf408b5543c515bffb53db4536bb6c96ac8197bdfdc1e70ec12f4','hex')))
on conflict (tag) do 
update set 
    index = taghashes.index + 1,
    hash = sha256(taghashes.hash || decode('78f60d7c56ebf408b5543c515bffb53db4536bb6c96ac8197bdfdc1e70ec12f4','hex')) 
returning taghashes.index, taghashes.hash;