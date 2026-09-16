# Rain Bird Local

Interface web local para consultar e controlar um Rain Bird ESP-RZXe com módulo Wi-Fi LNK.

## Preparar

É necessário Python 3.9 ou mais recente.

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Abrir

```sh
./start.sh
```

Depois acesse `http://localhost:8787`. O endereço inicial sugerido é `192.168.15.176`, mas pode ser alterado na própria tela.

O serviço escuta somente em `127.0.0.1`: outros aparelhos da rede não conseguem abrir a tela. O PIN do controlador fica apenas na memória e é descartado quando o servidor é encerrado.

## Recursos

- conexão local, sem publicar o controlador na internet;
- leitura das quatro zonas e do atraso por chuva;
- início de irrigação manual com duração definida;
- interrupção imediata da irrigação;
- confirmação visual antes de enviar comandos.

Este é um projeto independente e não possui afiliação com a Rain Bird Corporation. A comunicação utiliza a biblioteca comunitária `pyrainbird`; a compatibilidade pode variar conforme o controlador e o firmware.
