using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using BepInEx;

namespace Hexvane.Bridge
{
    /// <summary>
    /// Lets the Hexvane app change the game. Listens on 127.0.0.1 only; each request is one text
    /// line and gets one line back. Game objects are only touched on Unity's main thread (Update).
    /// </summary>
    [BepInPlugin("hexvane.bridge.gyk", "Hexvane Bridge", "0.1.0")]
    public class Plugin : BaseUnityPlugin
    {
        public const int Port = 47821;

        class Request
        {
            public string Line;
            public string Reply;
            public readonly ManualResetEventSlim Done = new ManualResetEventSlim();
        }

        readonly Queue<Request> _pending = new Queue<Request>();
        TcpListener _listener;
        bool _lockHealth, _lockStamina;

        void Awake()
        {
            // Unity stops calling Update when the window loses focus, which is exactly when the player clicks in Hexvane.
            UnityEngine.Application.runInBackground = true;
            _listener = new TcpListener(IPAddress.Loopback, Port);
            _listener.Start();
            new Thread(Listen) { IsBackground = true, Name = "Hexvane Bridge" }.Start();
            Logger.LogInfo($"Listening on 127.0.0.1:{Port}");
        }

        void OnDestroy() => _listener?.Stop();

        void Listen()
        {
            while (true)
            {
                TcpClient client;
                try { client = _listener.AcceptTcpClient(); }
                catch { return; } // listener stopped
                ThreadPool.QueueUserWorkItem(_ => Serve(client));
            }
        }

        void Serve(TcpClient client)
        {
            using (client)
            {
                try
                {
                    client.ReceiveTimeout = 2000;
                    var stream = client.GetStream();
                    var line = new StreamReader(stream, Encoding.UTF8).ReadLine();
                    if (line == null) return;
                    var req = new Request { Line = line };
                    lock (_pending) _pending.Enqueue(req);
                    // The main thread is paused while the game is minimised or loading; give up rather than hang.
                    var reply = req.Done.Wait(3000) ? req.Reply : "err game is busy";
                    var bytes = Encoding.UTF8.GetBytes(reply + "\n");
                    stream.Write(bytes, 0, bytes.Length);
                }
                catch (Exception e) { Logger.LogWarning(e.Message); }
            }
        }

        void Update()
        {
            while (true)
            {
                Request req;
                lock (_pending)
                {
                    if (_pending.Count == 0) break;
                    req = _pending.Dequeue();
                }
                try { req.Reply = Handle(req.Line.Trim().Split(' ')); }
                catch (Exception e) { req.Reply = "err " + e.Message; }
                req.Done.Set();
            }

            if (!InGame()) return;
            var player = MainGame.me.player;
            if (_lockHealth && player.hp < MainGame.me.save.max_hp) player.hp = MainGame.me.save.max_hp;
            if (_lockStamina && player.energy < MainGame.me.save.max_energy) player.energy = MainGame.me.save.max_energy;
        }

        static bool InGame() => MainGame.me != null && MainGame.game_started && MainGame.me.player != null && MainGame.me.save != null;

        string Handle(string[] a)
        {
            switch (a[0])
            {
                case "ping":
                    return "ok";
                case "state":
                    if (!InGame()) return "{\"inGame\":false}";
                    var p = MainGame.me.player;
                    // Invariant: the PC's locale may use a decimal comma, which would break the JSON.
                    return FormattableString.Invariant($"{{\"inGame\":true,\"health\":{(_lockHealth ? "true" : "false")},\"stamina\":{(_lockStamina ? "true" : "false")}")
                        + FormattableString.Invariant($",\"hp\":{p.hp},\"maxHp\":{MainGame.me.save.max_hp}")
                        + FormattableString.Invariant($",\"energy\":{p.energy},\"maxEnergy\":{MainGame.me.save.max_energy}")
                        + FormattableString.Invariant($",\"money\":{p.data.money},\"moneyText\":\"{Escape(Trading.FormatMoney(p.data.money, false, true))}\"}}");
                case "set": // set health|stamina 0|1
                    var on = a.Length > 2 && a[2] == "1";
                    if (a[1] == "health") _lockHealth = on;
                    else if (a[1] == "stamina") _lockStamina = on;
                    else return "err unknown cheat " + a[1];
                    return "ok";
            }

            if (!InGame()) return "err load a save first";
            switch (a[0])
            {
                case "money": // money <amount to add>; the game counts in silver: 100 = 1 gold, 0.01 = 1 copper
                    var data = MainGame.me.player.data;
                    data.money = Math.Max(0f, data.money + float.Parse(a[1], CultureInfo.InvariantCulture));
                    return "ok";
                case "give": // give <item id> <count>
                    var added = MainGame.me.player.AddToInventory(a[1], int.Parse(a[2]));
                    return added ? "ok" : "err inventory is full";
                case "items": // items [all]: "all" skips the filter, to see what the game has
                    var all = a.Length > 1 && a[1] == "all";
                    var sb = new StringBuilder("[");
                    foreach (var def in GameBalance.me.items_data)
                    {
                        if (!all && (!Giveable.Contains(def.type) || def.is_placeholder)) continue;
                        var name = def.GetItemName(true);
                        if (string.IsNullOrEmpty(name) || name.StartsWith("[")) continue; // untranslated: not a real item
                        if (sb.Length > 1) sb.Append(',');
                        sb.Append("[\"").Append(Escape(def.id)).Append("\",\"").Append(Escape(name)).Append("\",\"").Append(def.type).Append("\"]");
                    }
                    return sb.Append(']').ToString();
            }
            return "err unknown command " + a[0];
        }

        // Most ordinary items keep the default type (None). Body parts, souls, graves and workers are left out: giving them breaks quests.
        static readonly HashSet<ItemDefinition.ItemType> Giveable = new HashSet<ItemDefinition.ItemType>
        {
            ItemDefinition.ItemType.None, ItemDefinition.ItemType.Item, ItemDefinition.ItemType.Axe, ItemDefinition.ItemType.Pickaxe,
            ItemDefinition.ItemType.Shovel, ItemDefinition.ItemType.Sword, ItemDefinition.ItemType.Hammer, ItemDefinition.ItemType.FishingRod,
            ItemDefinition.ItemType.Torch, ItemDefinition.ItemType.HeadArmor, ItemDefinition.ItemType.BodyArmor, ItemDefinition.ItemType.Bait,
        };

        static string Escape(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", " ");
    }
}
