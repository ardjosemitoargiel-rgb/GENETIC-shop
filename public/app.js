let products=[],cart=JSON.parse(localStorage.getItem("genetic_cart")||"[]");
const $=s=>document.querySelector(s);
const money=n=>"$"+Number(n).toFixed(2);
async function load(){
 products=await (await fetch("/api/products")).json();
 $("#products").innerHTML=products.map(p=>`<article class="product"><img src="${p.image}" alt="${p.name}"><h3>${p.name}</h3><p>${p.color}</p><p class="price">${money(p.price)}</p><button class="add" onclick="add(${p.id})">ADD TO BAG</button></article>`).join("");
 renderBag();
}
function save(){localStorage.setItem("genetic_cart",JSON.stringify(cart));renderBag()}
function add(id){let x=cart.find(i=>i.id===id);x?x.quantity++:cart.push({id,quantity:1});save();openBag()}
function removeItem(id){cart=cart.filter(i=>i.id!==id);save()}
function change(id,d){let x=cart.find(i=>i.id===id);if(!x)return;x.quantity+=d;if(x.quantity<1)return removeItem(id);save()}
function total(){return cart.reduce((s,i)=>s+(products.find(p=>p.id===i.id)?.price||0)*i.quantity,0)}
function renderBag(){
 $("#count").textContent=cart.reduce((s,i)=>s+i.quantity,0);
 $("#total").textContent=money(total());
 $("#bagItems").innerHTML=cart.length?cart.map(i=>{let p=products.find(p=>p.id===i.id);return `<div class="bagitem"><img src="${p.image}"><div><h4>${p.name}</h4><small>${money(p.price)}</small><div class="qty"><button onclick="change(${p.id},-1)">−</button>${i.quantity}<button onclick="change(${p.id},1)">+</button></div></div><button class="remove" onclick="removeItem(${p.id})">Remove</button></div>`}).join(""):"<p>Your bag is empty.</p>";
}
function openBag(){$("#bagModal").classList.remove("hidden")}
function closeBag(){$("#bagModal").classList.add("hidden")}
function checkout(){
 if(!cart.length)return alert("Your bag is empty.");
 closeBag();
 $("#orderForm").classList.remove("hidden");
 $("#confirmation").classList.add("hidden");
 $("#checkoutModal").classList.remove("hidden");
 const lines=cart.map(i=>{let p=products.find(p=>p.id===i.id);return `<div style="display:flex;justify-content:space-between;margin:9px 0"><span>${p.name} × ${i.quantity}</span><b>${money(p.price*i.quantity)}</b></div>`}).join("");
 $("#summary").innerHTML=lines+`<hr><div style="display:flex;justify-content:space-between;font-size:18px"><b>Total</b><b>${money(total())}</b></div>`;
 $("#depositText").textContent=money(total()*0.7);
}
function closeCheckout(){$("#checkoutModal").classList.add("hidden")}
$("#orderForm").addEventListener("submit",async e=>{
 e.preventDefault();
 const data=Object.fromEntries(new FormData(e.target));
 data.items=cart;
 try{
  const r=await fetch("/api/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  const out=await r.json();
  if(!r.ok)throw new Error(out.error||"Order failed");
  $("#orderForm").classList.add("hidden");
  $("#confirmation").classList.remove("hidden");
  $("#confirmation").innerHTML=`<strong>Order received — ${out.order.id}</strong><br><br>Total: <b>${money(out.order.total)}</b><br>70% voorschot: <b>${money(out.order.deposit)}</b><br>Resterend 30%: <b>${money(out.order.balance)}</b><br><br>We nemen contact met je op met de bankgegevens en bevestigen je bestelling.<br><br><button class="primary" type="button" onclick="continueShopping()">CONTINUE SHOPPING</button>`;
  cart=[];save();
 }catch(err){alert(err.message)}
});
load();

function continueShopping(){ closeCheckout(); $("#orderForm").reset(); $("#orderForm").classList.remove("hidden"); $("#confirmation").classList.add("hidden"); window.scrollTo({top:0,behavior:"smooth"}); }
