import test from 'node:test';
import assert from 'node:assert/strict';
import {PermissionFlagsBits} from 'discord.js';
import {createDiscordRewards} from '../server/purchase-delivery.js';
test('Discord rewards add one role without replacing existing roles and recognise an already-held reward',async()=>{
 const guildId='323456789012345678',roleId='223456789012345670',userId='123456789012345678',calls=[],held=new Map([['other-role',{}]]),role={id:roleId,name:'Supporter',guild:{id:guildId},managed:false,editable:true,permissions:{has:()=>false}};
 const guild={
  id:guildId,
  roles:{cache:new Map([[roleId,role]]),fetch:async()=>{}},
  members:{
   fetchMe:async()=>{},
   fetch:async input=>{
    assert.equal(input.user,userId);assert.equal(input.force,true);
    return{roles:{cache:held,add:async(id,reason)=>{calls.push({id,reason});held.set(id,role);}}};
   }
  }
 };
 const rewards=createDiscordRewards(()=>({isReady:()=>true,guilds:{fetch:async id=>{assert.equal(id,guildId);return guild;}}}));assert.deepEqual(await rewards.roles(guildId),[{id:roleId,name:'Supporter'}]);assert.equal((await rewards.award(guildId,roleId,userId,'order-test')).preexisting,false);assert.equal((await rewards.award(guildId,roleId,userId,'order-test')).preexisting,true);assert.equal(calls.length,1);assert.equal(calls[0].id,roleId);assert.ok(calls[0].reason.includes('order-test'));assert.ok(held.has('other-role'));
 role.permissions.has=bit=>bit===PermissionFlagsBits.Administrator;assert.deepEqual(await rewards.roles(guildId),[]);await assert.rejects(rewards.check(guildId,roleId),/non-staff role/);role.permissions.has=()=>false;role.editable=false;await assert.rejects(rewards.check(guildId,roleId),/below the bot/);
});
