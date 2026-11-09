-- "Esconder o meu IP nas chamadas": a ligação passa sempre pelo servidor TURN do Txillapp, nunca diretamente,
-- e a outra pessoa não chega a ver o endereço IP de quem escolheu isto. Só tem efeito quando há TURN configurado.
ALTER TABLE identity.users ADD COLUMN calls_relay_only boolean NOT NULL DEFAULT false;
